module.exports = function(RED) {
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  const HEARTBEAT_PAYLOAD = "HEARTBEAT";
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20; // Prevent DoS

  // === VYTAŽENÍ PARAMETRŮ PRO ACK ZE ZPRÁVY (SEQ, RCV, LINE, ACCOUNT) ===
  function parseAckParams(rawStr, config) {
    let seq = "00";
    let receiver = "R0";
    let line = "L0";
    let account = "";

    // Zkusit nejprve přes robustní parser SIA
    let parsed = {};
    try {
      parsed = parseSIA(rawStr) || {};
    } catch {}

    // Account: nejprve z parseru, jinak z #account
    if (parsed.account) {
      account = parsed.account;
    } else {
      const m = rawStr.match(/#([0-9A-Za-z]{1,16})/);
      if (m) account = m[1];
    }
    // Sequence: z parseru nebo z [..]
    if (parsed.seq) {
      seq = parsed.seq;
    } else {
      const s = rawStr.match(/\[([0-9]{2})\]/);
      if (s) seq = s[1];
    }
    // Receiver: z parseru nebo R<n>
    if (parsed.receiver) {
      receiver = parsed.receiver;
    } else {
      const r = rawStr.match(/R([0-9A-Za-z])/i);
      if (r) receiver = `R${r[1]}`;
    }
    // Line: z parseru nebo L<n>
    if (parsed.line) {
      line = parsed.line;
    } else {
      const l = rawStr.match(/L([0-9A-Za-z])/i);
      if (l) line = `L${l[1]}`;
    }
    // Účet: podle režimu v configu (default: poslední 4 znaky)
    if (config && config.ackAccountFull) {
      // Některé panely chtějí celý účet (možnost volby v configu)
      account = account.toString().padStart(4, '0');
    } else {
      account = account.toString().padStart(4, '0').slice(-4);
    }

    return { seq, receiver, line, account };
  }

  // === GENEROVÁNÍ ACK PAKETU (PLNÝ ASCII DC-09) ===
  function buildAckPacket(seq, receiver, line, account) {
    const ackBody = `ACK${seq}${receiver}${line}#${account}`;
    if (ackBody.length !== 14) {
      // Fatální chyba, panel nebude komunikovat!
      throw new Error(`ACK BODY není 14 znaků! [${ackBody}]`);
    }
    const lenStr = pad(ackBody.length, 4);
    const crc = siaCRC(ackBody);
    const ack = `\r\n${lenStr}${ackBody}${crc}\r\n`;
    return Buffer.from(ack, 'ascii');
  }

  // === GENEROVÁNÍ ACK PRO JAKOUKOLI ZPRÁVU (vždy v ASCII) ===
  function getAckBuffer(cfg, rawStr, node) {
    try {
      const { seq, receiver, line, account } = parseAckParams(rawStr, cfg);
      const ackBuf = buildAckPacket(seq, receiver, line, account);
      if (node && node.debug) {
        node.debug(`ACK ascii: "${ackBuf.toString('ascii')}"`);
        node.debug(`ACK hex:   "${ackBuf.toString('hex')}"`);
      }
      return ackBuf;
    } catch (e) {
      if (node) node.error(`Chyba při sestavování ACK: ${e.message}`);
      // Fallback na ACK\r\n - ne DC-09, ale alespoň něco
      return Buffer.from("ACK\r\n", "ascii");
    }
  }

  // === ODESLÁNÍ ACK NA SOCKET (vždy v jednom TCP segmentu) ===
  function sendAck(socket, ackBuf, node) {
    try {
      if (!socket || !socket.writable) {
        node && node.warn("Socket není připraven pro odeslání ACK");
        return;
      }
      socket.write(ackBuf); // Buffer je vždy ASCII
      if (node && node.debug) {
        node.debug(`Odeslán ACK (${ackBuf.length} bajtů): ${ackBuf.toString('hex')}`);
      }
    } catch (err) {
      if (node) node.error(`Chyba při odesílání ACK: ${err.message}`);
    }
  }

  // === DYNAMICKÉ MAPOVÁNÍ (beze změny) ===
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

  // === HLAVNÍ NODE ===
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
      // Po připojení NUTNĚ nastavit NoDelay!
      socket.setNoDelay(true);

      if (sockets.length >= MAX_CONNECTIONS) {
        socket.destroy();
        node.warn("Překročen maximální počet spojení");
        return;
      }
      sockets.push(socket);
      setStatus("client connected");

      socket.on("data", function(data) {
        const rawStr = data.toString("ascii");
        node.debug && node.debug(`Received raw data: ${rawStr}`);
        try {
          // Detekce handshake (F# nebo D# na začátku řádku)
          const handshakeMatch = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);
          if (handshakeMatch) {
            const ackBuf = getAckBuffer(cfg, handshakeMatch[1], node);
            sendAck(socket, ackBuf, node);
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

          // Pokus o DC-09 zprávu
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
            const ackBuf = getAckBuffer(cfg, rawStr, node);
            sendAck(socket, ackBuf, node);

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
