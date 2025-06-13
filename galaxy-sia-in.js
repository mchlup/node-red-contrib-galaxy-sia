module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
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

  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    // 1. Vytvoříme základní ACK zprávu bez CR/LF
    const ackBody = `ACK${seq}${rcv}${lpref}#${account}`;
    
    // 2. Spočítáme skutečnou délku těla zprávy BEZ CR/LF
    const bodyLength = Buffer.from(ackBody).length;
    
    // 3. Vytvoříme padding délky na 4 znaky
    const lenStr = pad(bodyLength, 4);
    
    // 4. Vypočítáme CRC z těla zprávy (pouze z ackBody, ne z celé zprávy)
    const crc = siaCRC(ackBody);
    
    // 5. Sestavíme finální zprávu s CR/LF
    // Důležité: CR (\r) = hex 0D, LF (\n) = hex 0A
    const finalPacket = `\r\n${lenStr}${ackBody}${crc}\r\n`;
    
    // Debug log pro kontrolu výsledné zprávy
    if (DEBUG) {
        console.log('ACK packet components:', {
            ackBody,
            bodyLength,
            lenStr,
            crc,
            finalHex: Buffer.from(finalPacket).toString('hex')
        });
    }
    
    return finalPacket;
  }

  function getAckString(cfg, rawStr, node) {
    // Debug logging pro analýzu vstupních dat
    if (node && cfg.debug) {
      node.debug(`Raw ACK input: ${Buffer.from(rawStr).toString('hex')}`);
    }
    
    // Handshake detekce a zpracování
    if (rawStr.startsWith("F#") || rawStr.startsWith("D#")) {
      try {
        // Extrahujeme account číslo
        const account = rawStr.split("#")[1].replace(/[^\d]/g, '');
        
        // Vytvoříme standardizovaný ACK packet
        const ackStr = buildAckPacket(account);
        
        // Debug logging
        if (node && cfg.debug) {
          node.debug(`Handshake ACK generated: ${Buffer.from(ackStr).toString('hex')}`);
          node.debug(`ACK length check: ${ackStr.length}`);
          node.debug(`ACK parts: ${JSON.stringify({
            account: account,
            rawLength: rawStr.length,
            ackLength: ackStr.length,
            hexDump: Buffer.from(ackStr).toString('hex')
          })}`);
        }
        
        return ackStr;
      } catch (err) {
        if (node) node.error(`Error creating handshake ACK: ${err.message}`);
        return "ACK\r\n"; // Fallback response
      }
    }
    
    // Zpracování ostatních typů ACK
    switch (cfg.ackType) {
      case "SIA_PACKET":
        try {
          const parsed = parseSIA(rawStr);
          if (parsed.valid) {
            return buildAckPacket(parsed.account, parsed.seq || "00");
          }
        } catch (e) {
          if (node) node.warn(`Error creating SIA ACK packet: ${e.message}`);
        }
        return buildAckPacket(cfg.account, "00");
        
      case "A_CRLF":              return "A\r\n";
      case "A":                   return "A";
      case "ACK_CRLF":           return "ACK\r\n";
      case "ACK":                return "ACK";
      case "ECHO":               return rawStr;
      case "ECHO_TRIM_END":      return rawStr.slice(0, -1);
      case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
      case "ECHO_TRIM_BOTH":     return rawStr.trim();
      case "CUSTOM":             return cfg.ackCustom || "";
      default:
        if (node) node.warn(`Unknown ackType: ${cfg.ackType}, using 'ACK\\r\\n'`);
        return "ACK\r\n";
    }
  }

  function sendAck(socket, ackStr, node) {
    if (!socket || !socket.writable) {
      if (node) node.warn("Socket není připraven pro odeslání ACK");
      return;
    }
    try {
      // Převedeme string na Buffer, použijeme 'ascii' místo 'binary'
      // pro lepší zacházení s kontrolními znaky
      const ackBuffer = Buffer.from(ackStr, 'ascii');
        //const ackBuffer = Buffer.from(ackStr, "binary");
      // Debug logging před odesláním
      if (node && node.config && node.config.debug) {
        node.debug(`Sending ACK (${ackBuffer.length} bytes): ${ackBuffer.toString('hex')}`);
      }
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
        if (removed) {
          // Zde můžeme přidat další cleanup pokud je potřeba
        }
        done();
      });
    });
  }

  // Registrace typu nodu
  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
