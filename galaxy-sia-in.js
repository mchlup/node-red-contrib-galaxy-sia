module.exports = function(RED) {
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");

  // Local helpers for SIA DC-09
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

  // Extract SIA ACK params from a raw message
  function parseAckParams(rawStr, preferFullAccount) {
    let seq = "00", receiver = "R0", line = "L0", account = "";
    const accountMatch = rawStr.match(/#([0-9A-Za-z]{1,16})/);
    if (accountMatch) account = accountMatch[1];
    const seqMatch = rawStr.match(/\[([0-9]{2})\]/);
    if (seqMatch) seq = seqMatch[1];
    const receiverMatch = rawStr.match(/R([0-9A-Za-z])/i);
    if (receiverMatch) receiver = `R${receiverMatch[1]}`;
    const lineMatch = rawStr.match(/L([0-9A-Za-z])/i);
    if (lineMatch) line = `L${lineMatch[1]}`;
    // Account - either last 4 chars or full, by config
    if (!preferFullAccount) account = account.toString().padStart(4, '0').slice(-4);
    return { seq, receiver, line, account };
  }

  // Build full ACK packet
  function buildAckPacket(seq, receiver, line, account, alwaysCRLF, preferFullAccount) {
    const acct = preferFullAccount ? account : account.toString().padStart(4, '0').slice(-4);
    const ackBody = `ACK${seq}${receiver}${line}#${acct}`;
    if (ackBody.length !== 14) throw new Error(`ACK body must be 14 chars, got "${ackBody}"`);
    const lenStr = pad(ackBody.length, 4);
    const crc = siaCRC(ackBody);
    let ack = `${lenStr}${ackBody}${crc}`;
    if (alwaysCRLF) ack = `\r\n${ack}\r\n`;
    return Buffer.from(ack, 'ascii');
  }

  // Get correct ACK for any SIA message
  function getAck(cfg, rawStr, node) {
    const preferFullAccount = !!cfg.ackFullAccount;
    const alwaysCRLF = cfg.ackAlwaysCRLF !== false; // default true
    const { seq, receiver, line, account } = parseAckParams(rawStr, preferFullAccount);
    try {
      return buildAckPacket(seq, receiver, line, account, alwaysCRLF, preferFullAccount);
    } catch (e) {
      node && node.warn && node.warn(`Failed to build ACK: ${e.message}`);
      // fallback: generic ACK
      return Buffer.from("ACK\r\n", "ascii");
    }
  }

  function buildInquiryPacket(account, seq, type = "inquiry") {
    const seqStr = seq.toString().padStart(4, '0');
    if (type === "heartbeat") {
      return "\r\n0000#\r\n";
    }
    return `I${account},${seqStr},00\r\n`;
  }

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Get config node
    const cfg = RED.nodes.getNode(config.config);
    if (!cfg) {
      node.error("Chybí konfigurační uzel");
      node.status({ fill: "red", shape: "ring", text: "chybí konfigurace" });
      return;
    }

    if (!cfg.panelPort || !cfg.account) {
      node.error("Chybí povinné konfigurační hodnoty (port nebo account)");
      node.status({ fill: "red", shape: "ring", text: "neplatná konfigurace" });
      return;
    }

    let server;
    let sockets = [];
    let heartbeatTimer = null;
    const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";
    const HEARTBEAT_INTERVAL_DEFAULT = 60;
    const MAX_CONNECTIONS = 20;

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
      socket.setNoDelay(true); // Disable Nagle's algorithm
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
            const ackBuf = getAck(cfg, handshakeMatch[1], node);
            if (socket && socket.writable) {
              socket.write(ackBuf);
              node.debug && node.debug(`Sent handshake ACK hex: ${ackBuf.toString('hex')}`);
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

          // Zpracuj SIA zprávu
          const parsed = parseSIA(
            rawStr,
            cfg.siaLevel,
            cfg.encryption,
            cfg.encryptionKey,
            cfg.encryptionHex
          );

          node.debug && node.debug(`Parsed SIA message: ${JSON.stringify(parsed)}`);

          if (parsed.valid) {
            const ackBuf = getAck(cfg, rawStr, node);
            if (socket && socket.writable) {
              socket.write(ackBuf);
              node.debug && node.debug(`Sent SIA ACK hex: ${ackBuf.toString('hex')}`);
            }

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
          if (!s.destroyed) s.destroy();
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
        if (removed) { }
        done();
      });
    });
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
