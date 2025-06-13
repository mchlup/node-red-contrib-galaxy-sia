module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20; // Prevent DoS
  const POLLING_SEQ_START = 1;
  const POLLING_SEQ_MAX = 9999;

  function debugLog(node, message, data) {
    if (DEBUG && node && node.debug) {
      node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
    }
  }

  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0", crcFormat = "hex") {
    const acct = account.toString().padStart(4, '0').slice(-4);
    const ackBody = `ACK${seq}${rcv}${lpref}#${acct}`;
    const bodyLength = Buffer.from(ackBody).length;
    const lenStr = pad(bodyLength, 4);
    const crc = siaCRC(ackBody);

    if (crcFormat === "bin") {
      const crcHigh = parseInt(crc.substring(0, 2), 16);
      const crcLow = parseInt(crc.substring(2, 4), 16);
      return Buffer.concat([
        Buffer.from('\r\n' + lenStr + ackBody, 'ascii'),
        Buffer.from([crcHigh, crcLow]),
        Buffer.from('\r\n', 'ascii')
      ]);
    } else {
      return Buffer.from(`\r\n${lenStr}${ackBody}${crc}\r\n`, 'ascii');
    }
  }

  function getAckString(cfg, rawStr, node) {
    const crcFormat = cfg.ackCrcFormat || "hex";
    node.debug && node.debug(`Processing message for ACK: ${rawStr}`);
    if (rawStr.startsWith("F#") || rawStr.startsWith("D#")) {
      const seq = "00";
      const account = (rawStr.split("#")[1] || "").match(/\d+/)?.[0] || "";
      return buildAckPacket(account, seq, "R0", "L0", crcFormat);
    }
    switch (cfg.ackType) {
      case "SIA_PACKET":
        try {
          const parsed = parseSIA(rawStr);
          if (parsed.valid) {
            return buildAckPacket(parsed.account, parsed.seq || "00", "R0", "L0", crcFormat);
          }
        } catch (e) {
          node.warn && node.warn("Error creating SIA ACK packet: " + e.message);
        }
        return buildAckPacket(cfg.account, "00", "R0", "L0", crcFormat);
      case "A_CRLF": return "A\r\n";
      case "A": return "A";
      case "ACK_CRLF": return "ACK\r\n";
      case "ACK": return "ACK";
      case "ECHO": return rawStr;
      default: return "ACK\r\n";
    }
  }

  function sendAck(socket, ack, node) {
    if (!socket || !socket.writable) {
      if (node) node.warn("Socket není připraven pro odeslání ACK");
      return;
    }
    try {
      if (Buffer.isBuffer(ack)) {
        socket.write(ack);
      } else {
        socket.write(Buffer.from(ack, 'ascii'));
      }
      node && node.debug && node.debug(`Sent ACK (${Buffer.isBuffer(ack) ? ack.length : Buffer.byteLength(ack)}) bytes`);
    } catch (err) {
      if (node) node.error(`Error sending ACK: ${err.message}`);
    }
  }

  function buildInquiryPacket(account, seq, type = "inquiry") {
    const seqStr = seq.toString().padStart(4, '0');
    if (type === "heartbeat") {
      return HEARTBEAT_PAYLOAD;
    }
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
    let pollingTimers = [];
    let inquirySeq = POLLING_SEQ_START;

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

    function startPolling(socket) {
      stopPolling(socket);
      const interval = Number(cfg.periodicReportInterval) || 10;
      if (interval > 0) {
        socket.poller = setInterval(() => {
          if (socket.writable) {
            const pkt = buildInquiryPacket(cfg.account, inquirySeq, cfg.pollingType);
            socket.write(pkt);
            inquirySeq = inquirySeq < POLLING_SEQ_MAX ? inquirySeq + 1 : POLLING_SEQ_START;
            setStatus(`polling: ${cfg.pollingType} (${interval}s)`, "blue", "ring");
          }
        }, interval * 1000);
        pollingTimers.push(socket.poller);
      }
    }
    function stopPolling(socket) {
      if (socket && socket.poller) {
        clearInterval(socket.poller);
        socket.poller = null;
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

      startPolling(socket);

      socket.on("data", function(data) {
        const rawStr = data.toString();
        node.debug && node.debug(`Received raw data: ${rawStr}`);
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

          node.debug && node.debug(`Parsed SIA message: ${JSON.stringify(parsed)}`);

          if (parsed.valid) {
            const ackStr = getAckString(cfg, rawStr, node);
            if (socket && socket.writable) {
              sendAck(socket, ackStr, node);
            }

            node.debug && node.debug({
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
          node.debug && node.debug({
            event: "error",
            raw: rawStr,
            error: err.message
          });
        }
      });

      socket.on("close", () => {
        stopPolling(socket);
        setStatus("client disconnected", "yellow", "ring");
        cleanupSockets();
      });

      socket.on("error", err => {
        stopPolling(socket);
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
      pollingTimers.forEach(t => clearInterval(t));
      pollingTimers = [];
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
          stopPolling(s);
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
        if (removed) {
        }
        done();
      });
    });
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
