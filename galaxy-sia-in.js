module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");

  const pad = parseSIA.pad;

  const HEARTBEAT_PAYLOAD = "HEARTBEAT";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20; // Prevent DoS

  // Funkce pro debug log
  function debugLog(node, message, data) {
    if (DEBUG) {
      node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
    }
  }

  function getAckString(cfg, rawStr, node) {
    node.debug(`Processing message for ACK: ${rawStr}`);
    // Pro handshake používáme specifický formát
    if (rawStr.startsWith("F#") || rawStr.startsWith("D#")) {
      const account = rawStr.split("#")[1].replace(/[^\d]/g, '');
      const ackBody = `ACK00R0L0#${account}`;
      // Délka těla ACK vždy 4 číslice
      const len = ackBody.length.toString().padStart(4, '0');
      // SIA CRC vždy 4 znaky HEX (DC-09 standard)
      const crc = parseSIA.siaCRC(ackBody);
      const ackStr = `\r\n${len}${ackBody}${crc}\r\n`;
      node.debug(`Sending handshake ACK: ${ackStr}`);
      return ackStr;
    }
    // Ostatní typy ACK zůstávají stejné
    switch (cfg.ackType) {
      case "SIA_PACKET":
        try {
          const parsed = parseSIA(rawStr);
          if (parsed.valid) {
            const ackBody = `ACK${parsed.seq || "00"}R0L0#${parsed.account}`;
            const len = pad(ackBody.length, 4);
            let crc = parseSIA.siaCRC(ackBody);
            return `\r\n${len}${ackBody}${crc}\r\n`;
          }
        } catch (e) {
          node.warn("Error creating SIA ACK packet: " + e.message);
        }
        // Fallback to simple ACK if parsing fails
        return "ACK\r\n";

      case "A_CRLF":              return "A\r\n";
      case "A":                   return "A";
      case "ACK_CRLF":            return "ACK\r\n";
      case "ACK":                 return "ACK";
      case "ECHO":                return rawStr;
      case "ECHO_TRIM_END":       return rawStr.slice(0, -1);
      case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
      case "ECHO_TRIM_BOTH":      return rawStr.trim();
      case "CUSTOM":              return cfg.ackCustom || "";
      default:
        node.warn("Unknown ackType: " + cfg.ackType + ", using 'ACK\\r\\n'");
        return "ACK\r\n";
    }
  }

  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    const body = `ACK${seq}${rcv}${lpref}#${account}`;
    const len = pad(body.length, 4);
    let crc = parseSIA.siaCRC(body);
    return `\r\n${len}${body}${crc}\r\n`;
  }

  function sendAck(node, socket, ackStr) {
    try {
      if (!socket.writable) {
        node.warn("Socket not writable when trying to send ACK");
        return;
      }

      // Ensure proper encoding and transmission
      if (ackStr.startsWith("\r\n")) {
        // Send as buffer for binary safety
        socket.write(Buffer.from(ackStr, "binary"));
      } else {
        // Send as regular string for simple ACKs
        socket.write(ackStr);
      }

      node.debug(`ACK sent successfully: ${ackStr}`);
    } catch (err) {
      node.error("Error sending ACK: " + err.message);
    }
  }

  function loadDynamicMapping(path, node) {
    try {
      if (!path) return null;
      if (!fs.existsSync(path)) return null;
      const content = fs.readFileSync(path, "utf-8");
      const parsed = JSON.parse(content);
      // Očekáváno: { zoneMap: {...}, userMap: {...}, areaMap: {...} }
      if (typeof parsed !== "object") throw new Error("Externí mapování není objekt");
      return parsed;
    } catch (e) {
      if (node) node.warn("Nepodařilo se načíst externí mapování: " + e.message);
      return null;
    }
  }

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get the config node
    const cfg = RED.nodes.getNode(config.config);
    if (!cfg) {
      node.error("Chybí konfigurační uzel");
      node.status({fill:"red", shape:"ring", text:"chybí konfigurace"});
      return;
    }

    // Ověření požadovaných konfiguračních hodnot
    if (!cfg.panelPort || !cfg.account) {
      node.error("Chybí povinné konfigurační hodnoty (port nebo account)");
      node.status({fill:"red", shape:"ring", text:"neplatná konfigurace"});
      return;
    }

    let server;
    let sockets = [];
    let heartbeatTimer = null;

    function setStatus(text, color = "green", shape = "dot") {
      node.status({ fill: color, shape: shape, text: text });
    }

    function startHeartbeat() {
      stopHeartbeat();
      const interval = Number(cfg.heartbeatInterval) || HEARTBEAT_INTERVAL_DEFAULT;
      if (interval > 0) {
        heartbeatTimer = setInterval(() => {
          sockets.forEach(socket => {
            if (socket.writable) {
              // Pro správnou SIA zprávu použijte správný SIA packet (např. DUH), ne prostý text!
              // socket.write(HEARTBEAT_PAYLOAD);
            }
          });
          setStatus("heartbeat sent", "blue", "ring");
        }, interval * 1000);
      }
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function cleanupSockets() {
      sockets = sockets.filter(s => !s.destroyed);
    }

    function handleSocket(socket) {
      if (sockets.length >= MAX_CONNECTIONS) {
        socket.destroy();
        node.warn("Překročen maximální počet spojení");
        return;
      }
      sockets.push(socket);
      setStatus("client connected");

      socket.on("data", function(data) {
        const rawStr = data.toString();
        node.debug(`Received raw data: ${rawStr}`);
        
        try {
          // Handshake detekce
          const h = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);
          if (h) {
            const ackStr = getAckString(cfg, h[1], node);
            sendAck(node, socket, ackStr);
            setStatus("handshake");

            // Rozšířené logování pro handshake
            node.debug({
              event: "handshake",
              received: rawStr,
              sending: ackStr,
              account: h[1].split("#")[1]
            });

            node.send([{
              payload: {
                type: "handshake",
                ack: ackStr,
                raw: rawStr,
                account: h[1].split("#")[1],
                timestamp: new Date().toISOString()
              }
            }, null]);
            return;
          }

          // Pokud to není handshake, zkusíme parsovat jako SIA zprávu
          const parsed = parseSIA(
            rawStr,
            cfg.siaLevel,
            cfg.encryption,
            cfg.encryptionKey,
            cfg.encryptionHex
          );

          node.debug(`Parsed SIA message: ${JSON.stringify(parsed)}`);

          if (parsed.valid) {
            const ackStr = getAckString(cfg, rawStr, node);
            sendAck(node, socket, ackStr);

            node.debug({
              event: "message",
              parsed: parsed,
              ack: ackStr
            });

            // Odešleme zprávu s daty
            node.send([{
              payload: {
                ...parsed,
                type: "sia_message",
                ack: ackStr,
                raw: rawStr,
                timestamp: new Date().toISOString()
              }
            }, null]);
          } else {
            node.warn(`Invalid message received: ${rawStr}`);
          }
        } catch (err) {
          node.error(`Error processing message: ${err.message}`);
          node.debug({
            event: "error",
            raw: rawStr,
            error: err.message
          });
        }
      });

      socket.on("close", () => {
        setStatus("client disconnected", "yellow", "ring");
        cleanupSockets();
      });

      socket.on("error", err => {
        node.error("Socket error: " + err.message);
        setStatus("socket error", "red", "ring");
      });
    }

    function startServer() {
      if (server) return;

      try {
        server = net.createServer(handleSocket);

        server.on("connection", function(socket) {
          // Limit number of connections
          if (sockets.length >= MAX_CONNECTIONS) {
            socket.destroy();
            node.warn("Překročen maximální počet spojení");
            return;
          }
          handleSocket(socket);
        });

        server.on("error", err => {
          node.error("Server error: " + err.message);
          setStatus("server error", "red", "dot");
        });

        server.listen(cfg.panelPort, () => {
          setStatus("listening");
          node.log(`Server listening on port ${cfg.panelPort}`);
        });

        startHeartbeat();
      } catch (err) {
        node.error("Failed to start server: " + err.message);
        setStatus("start failed", "red", "dot");
      }
    }

    function stopServer(done) {
      stopHeartbeat();

      if (server) {
        try {
          server.close(() => {
            server = null;
            if (done) done();
          });
        } catch (err) {
          node.error("Error stopping server: " + err.message);
          if (done) done();
        }
      } else {
        if (done) done();
      }

      // Cleanup all sockets
      sockets.forEach(s => {
        try {
          if (!s.destroyed) {
            s.destroy();
          }
        } catch (err) {
          node.error("Error cleaning up socket: " + err.message);
        }
      });
      sockets = [];
      setStatus("stopped", "grey", "ring");
    }

    // Spuštění serveru při inicializaci
    startServer();

    // Cleanup při zavření nodu
    this.on("close", function(removed, done) {
      stopServer(() => {
        // Extra cleanup pro případ odstranění nodu
        if (removed) {
          // Zde můžeme přidat další cleanup pokud je potřeba
        }
        done();
      });
    });
  }

  // Registrace typu nodu - upravená kategorie
  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode, {
    category: "Galaxy SIA Connector",
    defaults: {
      name: { value: "" },
      config: { type: "galaxy-sia-config", required: true }
    },
    color: "#a6d7a8",
    inputs: 0,
    outputs: 2,
    icon: "font-awesome/fa-arrow-left",
    label: function() {
      return this.name || "galaxy-sia-in";
    },
    paletteLabel: "galaxy-sia-in"
  });
};
