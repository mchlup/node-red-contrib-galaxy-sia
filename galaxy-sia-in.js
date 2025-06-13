// galaxy-sia-in.js
// Node-RED custom node: Galaxy Dimension SIA DC-09 connector
// - Správné odesílání 14b ACK (CRC) pro handshake i eventy
// - Pravidelné inquiry polling pro získání stavových zpráv

module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  // Konstanty
  const ACK_BODY_LENGTH = 14;       // tělo ACK musí mít vždy 14 znaků
  const ACCOUNT_PAD_LENGTH = 4;     // suffix účtu 4 znaky
  const INQ_INTERVAL_DEFAULT = 10;  // výchozí polling interval v sekundách
  const MAX_CONNECTIONS = 20;       // limit připojení

  function debugLog(node, message, data) {
    if (DEBUG) node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
  }

  // Vytvoří 14b ACK paket s prefixem délky a CRC
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

  // Hlavní třída uzlu
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

    function setStatus(text, color = 'green', shape = 'dot') {
      node.status({ fill: color, shape: shape, text: text });
    }

    // Ošetření jedné klientské socket komunikace
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

    // Start TCP server
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

    startServer();
  }

  RED.nodes.registerType('galaxy-sia-in', GalaxySIAInNode);
};
