module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  // Konstanty pro ACK formát
  const ACK_BODY_LENGTH = 14;           // tělo ACK musí mít vždy 14 znaků
  const ACCOUNT_PAD_LENGTH = 4;         // délka suffixu čísla účtu v ACK (4 znaky)
  const INQ_INTERVAL_DEFAULT = 10;  // výchozí polling interval v sekundách
  // SIA DC-09 keepalive (heartbeat) zpráva: prázdné vyžádání (0-length)
  const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  let heartbeatTimer = null;
  const MAX_CONNECTIONS = 20; // Prevent DoS

  function debugLog(node, message, data) {
    if (DEBUG) {
      node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
    }
  }

  // Sestaví SIA DC-09 ACK paket (tělo = 14 znaků)
  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    const acct = account.toString().padStart(ACCOUNT_PAD_LENGTH, '0').slice(-ACCOUNT_PAD_LENGTH);
    const ackBody = `ACK${seq}${rcv}${lpref}#${acct}`;
    if (ackBody.length !== ACK_BODY_LENGTH) {
      console.warn(`ACK BODY length is NOT ${ACK_BODY_LENGTH}: ${ackBody.length} [${ackBody}]`);
    }
    const len = pad(ACK_BODY_LENGTH, 4); // always '0014'
    const crc = siaCRC(ackBody);
    return `\r\n${len}${ackBody}${crc}\r\n`;
  }

  // Vytvoří inquiry dotaz: I<account>,<seq4>,00 + CRLF
  function buildInquiry(account, seq) {
    const acct = account.toString();
    const seqStr = seq.toString().padStart(4, '0');
    return `I${acct},${seqStr},00\r\n`;
  }

  // Vytvoří ACK string podle typu zprávy
  function getAckString(cfg, rawStr, node) {
    node.debug(`Processing message for ACK: ${rawStr}`);

    // Handshake (F# / D#)
    const handshakeMatch = rawStr.match(/^([FD]#?\d+)[^\r\n]*/);
    if (handshakeMatch) {
      const rawAccount = (handshakeMatch[1].split("#")[1] || "");
      const seq = "00";
      const ackPacket = buildAckPacket(rawAccount, seq, "R0", "L0");
      node.debug(`Handshake ACK Packet: ${ackPacket}`);
      return ackPacket;
    }

    switch (cfg.ackType) {
      case "SIA_PACKET":
        try {
          const parsed = parseSIA(rawStr);
          if (parsed.valid) {
            const seq = parsed.seq || "00";
            const ackPacket = buildAckPacket(parsed.account, seq, "R0", "L0");
            node.debug(`Message ACK Packet: ${ackPacket}`);
            return ackPacket;
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
      default:         return "ACK\r\n";
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

    // Konfigurační uzel
    const cfg = RED.nodes.getNode(config.config);
    if (!cfg || !cfg.panelPort || !cfg.account) {
      node.error("Neplatná konfigurace: chybí panelPort nebo account");
      node.status({fill:"red",shape:"ring",text:"špatná konfigurace"});
      return;
    }

    let server = null;

    if (!cfg.panelPort || !cfg.account) {
      node.error("Chybí povinné konfigurační hodnoty (port nebo account)");
      node.status({fill:"red", shape:"ring", text:"neplatná konfigurace"});
      return;
    }

    let sockets = [];
    let heartbeatTimer = null;

    function setStatus(text, color = 'green', shape = 'dot') {
      node.status({ fill: color, shape: shape, text: text });
    }

    function startHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
      if (server.connections > MAX_CONNECTIONS) {
        socket.destroy();
        node.warn("Překročen maximální počet spojení");
        return;
      }

      let pollTimer = null;
      let inquirySeq = 1;

      function startPolling() {
        stopPolling();
        const interval = Number(cfg.pollInterval) || INQ_INTERVAL_DEFAULT;
        pollTimer = setInterval(() => {
          const inq = buildInquiry(cfg.account, inquirySeq);
          socket.write(inq);
          debugLog(node, `Sent inquiry`, inq.trim());
          inquirySeq = (inquirySeq % 9999) + 1;
        }, interval * 1000);
        setStatus(`polling every ${interval}s`, 'blue', 'ring');
      }
      function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }

      socket.on('data', data => {
        const raw = data.toString('ascii');
        debugLog(node, 'Received raw data', raw);

        // Rozdělíme na řádky (CRLF)
        const parts = raw.split(/\r?\n/).filter(l => l);
        parts.forEach(line => {
          // Handshake (F#... / D#...)
          const hs = line.match(/^([FD]#?[0-9A-Za-z]+)/);
          if (hs) {
            const account = hs[1].split('#')[1];
            const ack = buildAckPacket(account);
            socket.write(ack);
            debugLog(node, 'Sent handshake ACK', ack.trim());
            setStatus('handshake');

            node.send({
              topic: 'handshake',
              payload: { type: 'handshake', raw: line, ack: ack, account: account, timestamp: new Date().toISOString() }
            });

            // Spustíme polling dotazů
            startPolling();
            return;
          }

          // Pokus o parsování SIA event/status/null
          let parsed;
          try {
            parsed = parseSIA(line, cfg.siaLevel, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);
          } catch(err) {
            node.warn(`Nepodařilo se parsovat: ${err.message}`);
            return;
          }

          if (parsed.valid) {
            // ACK eventu
            const seq = parsed.seq || '00';
            const ack = buildAckPacket(parsed.account, seq);
            socket.write(ack);
            debugLog(node, 'Sent event ACK', ack.trim());

            // Emit event
            node.send({
              topic: parsed.eventType || 'sia_event',
              payload: { ...parsed, raw: line, ack: ack, timestamp: new Date().toISOString() }
            });
          } else {
            node.warn(`Neplatný SIA paket: ${line}`);
          }
        });
      });

      socket.on('close', () => {
        stopPolling();
        setStatus('disconnected', 'yellow', 'ring');
      });
      socket.on('error', err => {
        stopPolling();
        node.error(`Socket error: ${err.message}`);
        setStatus('socket error', 'red', 'ring');
      });
    }

    function startServer() {
      server = net.createServer(handleSocket);
      server.maxConnections = MAX_CONNECTIONS;
      server.listen(cfg.panelPort, () => {
        node.log(`Listening on port ${cfg.panelPort}`);
        setStatus('listening');
      });
      server.on('error', err => {
        node.error(`Server error: ${err.message}`);
        setStatus('server error', 'red', 'dot');
      });
    }

    // Stop server on close
    this.on('close', done => {
      if (server) {
        server.close(() => done());
      } else done();
    });

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
