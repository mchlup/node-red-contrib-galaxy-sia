module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  // Konstanty pro ACK formát
  const ACK_BODY_LENGTH = 14;           // tělo ACK musí mít vždy 14 znaků
  const ACCOUNT_PAD_LENGTH = 4;         // délka čísla účtu v ACK (před #)

  // SIA DC-09 keepalive (heartbeat) zpráva: prázdné vyžádání (0-length)
  const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20; // Prevent DoS

  function debugLog(node, message, data) {
    if (DEBUG) {
      node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
    }
  }

  // Sestaví SIA DC-09 ACK paket (tělo = 14 znaků)
  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    // Zarovnáme číslo účtu na pevnou délku
    const accountPadded = pad((account || "").toString(), ACCOUNT_PAD_LENGTH);
    const ackBody = `ACK${seq}${rcv}${lpref}#${accountPadded}`;
    // Délka těla by měla být konstantní
    if (ackBody.length !== ACK_BODY_LENGTH) {
      console.warn(`ACK BODY length is NOT ${ACK_BODY_LENGTH}: ${ackBody.length} [${ackBody}]`);
    }
    const lenStr = pad(ACK_BODY_LENGTH, 4); // vždy "0014"
    const crc = siaCRC(ackBody);
    return `\r\n${lenStr}${ackBody}${crc}\r\n`;
  }

// Vytvoří ACK string podle typu zprávy
  function getAckString(cfg, rawStr, node) {
    node.debug(`Processing message for ACK: ${rawStr}`);

    // Handshake (F# / D#)
    const handshakeMatch = rawStr.match(/^([FD]#?\d+)[^\r\n]*/);
    if (handshakeMatch) {
      const rawAccount = (handshakeMatch[1].split("#")[1] || "");
      const seq = "00";
      const accountPadded = pad(rawAccount, ACCOUNT_PAD_LENGTH);
      const ackBody = `ACK${seq}R0L0#${accountPadded}`;
      node.debug(`Handshake ACK BODY (${ackBody.length}b): ${ackBody}`);
      return buildAckPacket(rawAccount, seq, "R0", "L0");
    }

    switch (cfg.ackType) {
      case "SIA_PACKET":
        try {
          const parsed = parseSIA(rawStr);
          if (parsed.valid) {
            const seq = parsed.seq || "00";
            const accountPadded = pad(parsed.account.toString(), ACCOUNT_PAD_LENGTH);
            const ackBody = `ACK${seq}R0L0#${accountPadded}`;
            node.debug(`Message ACK BODY (${ackBody.length}b): ${ackBody}`);
            return buildAckPacket(parsed.account, seq, "R0", "L0");
          }
        } catch (err) {
          node.warn(`Error creating SIA ACK packet: ${err.message}`);
        }
        return "ACK\r\n";

      case "A_CRLF":   return "A\r\n";
      case "A":        return "A";
      case "ACK_CRLF": return "ACK\r\n";
      case "ACK":      return "ACK";
      case "ECHO":     return rawStr;
      default:          return "ACK\r\n";
    }
  }

  // Odeslání ACK na socket
  function sendAck(socket, ackStr, node) {
    if (!socket || !socket.writable) {
      if (node) node.warn("Socket není připraven pro odeslání ACK");
      return;
    }
    try {
      const ackBuffer = Buffer.from(ackStr, 'ascii');
      node.debug(`Sending ACK (${ackBuffer.length} bytes): ${ackBuffer.toString('hex')}`);
      socket.write(ackBuffer);
    } catch (err) {
      if (node) node.error(`Error sending ACK: ${err.message}`);
    }
  }

  function loadDynamicMapping(path, node) {
    try {
      if (!path) return null;
      if (!fs.existsSync(path)) return null;
      const content = fs.readFileSync(path, "utf-8");
      const parsed = JSON.parse(content);
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
        cleanupSockets();
        sockets.forEach(socket => {
          if (socket.writable) {
            socket.write(HEARTBEAT_PAYLOAD);
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
            if (socket && socket.writable) {
              sendAck(socket, ackStr, node);
            } else {
              node.warn("Socket není připraven pro odeslání ACK");
            }
            setStatus("handshake");

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
            if (socket && socket.writable) {
              sendAck(socket, ackStr, node);
            }

            node.debug({
              event: "message",
              parsed: parsed,
              ack: ackStr
            });

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

    startServer();

    this.on("close", function(removed, done) {
      stopServer(() => {
        if (removed) {
          // Extra cleanup pokud bude potřeba
        }
        done();
      });
    });
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
