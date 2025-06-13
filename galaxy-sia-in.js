module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  // Fallback CRC/pad if not present in parser:
  function pad(num, len) {
    let s = String(num);
    while (s.length < len) s = "0" + s;
    return s;
  }
  function siaCRC(input) {
    let crc = 0x0000;
    for (let i = 0; i < input.length; i++) {
      crc ^= input.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000)
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
      }
    }
    return pad(crc.toString(16).toUpperCase(), 4);
  }

  const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20; // Prevent DoS

  // --- UTILITIES ---

  /**
   * Parse SIA DC-09 message for ACK construction
   * Returns { seq, receiver, line, account }, with safe fallbacks (R0/L0)
   */
  function parseAckParams(rawStr) {
    // Default fallback values
    let seq = "00";
    let receiver = "R0";
    let line = "L0";
    let account = "";

    // Account: after # (at least 1, up to 16 chars)
    const accountMatch = rawStr.match(/#([0-9A-Za-z]{1,16})/);
    if (accountMatch) {
      account = accountMatch[1];
    }
    // Sequence: inside [..]
    const seqMatch = rawStr.match(/\[([0-9]{2})\]/);
    if (seqMatch) {
      seq = seqMatch[1];
    }
    // Receiver (R0, R1, ...)
    const receiverMatch = rawStr.match(/R([0-9A-Za-z])/i);
    if (receiverMatch) {
      receiver = `R${receiverMatch[1]}`;
    }
    // Line (L0, L1, ...)
    const lineMatch = rawStr.match(/L([0-9A-Za-z])/i);
    if (lineMatch) {
      line = `L${lineMatch[1]}`;
    }
    return { seq, receiver, line, account };
  }

  /**
   * Build SIA DC-09 ACK packet (ASCII, CRLF, length, CRC)
   */
  function buildAckPacket(seq, receiver, line, account) {
    // SIA standard: always last 4 chars zero-padded
    const acct = account.toString().padStart(4, '0').slice(-4);
    const ackBody = `ACK${seq}${receiver}${line}#${acct}`;
    if (ackBody.length !== 14) throw new Error(`ACK body must be 14 chars, got "${ackBody}"`);
    const lenStr = pad(ackBody.length, 4);
    const crc = siaCRC(ackBody);
    const ack = `\r\n${lenStr}${ackBody}${crc}\r\n`;
    return Buffer.from(ack, 'ascii');
  }

  /**
   * Get correct ACK string/buffer for any incoming SIA message (handshake or event)
   */
  function getAckBuffer(rawStr, node) {
    const params = parseAckParams(rawStr);
    try {
      const ack = buildAckPacket(params.seq, params.receiver, params.line, params.account);
      node && node.debug && node.debug(`ACK HEX: ${ack.toString('hex')}, RAW: ${ack.toString('ascii')}`);
      return ack;
    } catch (e) {
      node && node.warn && node.warn(`Failed to build ACK: ${e.message}`);
      // fallback: default (may not be accepted by panel!)
      return Buffer.from("ACK\r\n", "ascii");
    }
  }

  function sendAck(socket, ack, node) {
    if (!socket || !socket.writable) {
      if (node) node.warn("Socket není připraven pro odeslání ACK");
      return;
    }
    try {
      socket.write(ack);
      node && node.debug && node.debug(`Sent ACK (${ack.length} bytes): ${ack.toString('hex')}`);
    } catch (err) {
      if (node) node.error(`Error sending ACK: ${err.message}`);
    }
  }

  function buildInquiryPacket(account, seq, type = "inquiry") {
    const seqStr = pad(seq, 4);
    if (type === "heartbeat") {
      return "\r\n0000#\r\n";
    }
    // 'I<account>,<seq>,00\r\n'
    return `I${account},${seqStr},00\r\n`;
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
      // DŮLEŽITÉ: některé panely vyžadují odesílání v jednom TCP segmentu (vypni Nagle)
      socket.setNoDelay(true);

      if (sockets.length >= MAX_CONNECTIONS) {
        socket.destroy();
        node.warn("Překročen maximální počet spojení");
        return;
      }
      sockets.push(socket);
      setStatus("client connected");

      socket.on("data", function(data) {
        const rawStr = data.toString();
        node.debug && node.debug(`Received raw data: ${rawStr}`);
        try {
          // Handshake detekce (F# nebo D#)
          const handshakeMatch = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);
          if (handshakeMatch) {
            const ackBuf = getAckBuffer(handshakeMatch[1], node);
            if (socket && socket.writable) {
              sendAck(socket, ackBuf, node);
            } else {
              node.warn("Socket není připraven pro odeslání ACK");
            }
            setStatus("handshake");

            node.send([{
              payload: {
                type: "handshake",
                ack: ackBuf,
                raw: rawStr,
                account: handshakeMatch[1].split("#")[1],
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

          node.debug && node.debug(`Parsed SIA message: ${JSON.stringify(parsed)}`);

          if (parsed.valid) {
            // ACK podle skutečných hodnot ve zprávě!
            const ackBuf = getAckBuffer(rawStr, node);
            if (socket && socket.writable) {
              sendAck(socket, ackBuf, node);
            }

            node.debug && node.debug({
              event: "message",
              parsed: parsed,
              ack: ackBuf
            });

            node.send([{
              payload: {
                ...parsed,
                type: "sia_message",
                ack: ackBuf,
                raw: rawStr,
                timestamp: new Date().toISOString()
              }
            }, null]);
          } else {
            node.warn(`Invalid message received: ${rawStr}`);
          }
        } catch (err) {
          node.error(`Error processing message: ${err.message}`);
          node.debug && node.debug({
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
          // případný dodatečný cleanup
        }
        done();
      });
    });
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
