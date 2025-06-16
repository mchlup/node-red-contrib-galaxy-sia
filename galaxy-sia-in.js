module.exports = function(RED) {
  const DEBUG = true;
  const net = require("net");
  const fs = require("fs");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC = parseSIA.siaCRC;
  const pad = parseSIA.pad;

  // Default interval: 60 s
  const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds
  const MAX_CONNECTIONS = 20;
  const ACK_LENGTH = 26;

  function validateAckLength(ackBuffer) {
    return ackBuffer.length === ACK_LENGTH;
  }

  function debugLog(node, message, data) {
    if (DEBUG) {
      node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
    }
  }

  /**
   * Vytvoří správně formátovanou ACK zprávu podle SIA DC-09
   * @param {string} message - Původní zpráva pro extrakci seq/rcv/line/account
   * @param {object} node - Node objekt pro logging
   * @returns {Buffer} - Buffer obsahující přesně formátovanou ACK zprávu
   */
  function createAckMessage(message, node) {
    try {
      // 1. Extrahuj sequence nebo použij default "00"
      const seqMatch = message.match(/\[([0-9A-F]{2})\]/i);
      const seq = seqMatch ? seqMatch[1] : "00";

      // 2. Extrahuj receiver/line nebo použij defaulty
      const rcvMatch = message.match(/R([0-9A-F])/i);
      const lineMatch = message.match(/L([0-9A-F])/i);
      const receiver = rcvMatch ? `R${rcvMatch[1]}` : "R0";
      const line = lineMatch ? `L${lineMatch[1]}` : "L0";

      // 3. Extrahuj account (HEX) a doplň zleva nulami na 4 znaky
      const accMatch = message.match(/#([0-9A-F]+)/i);
      let account = accMatch ? accMatch[1].toUpperCase() : "0000";
      account = account.replace(/[^0-9A-F]/gi, ""); // pouze platné znaky
      if (account.length < 4) {
        account = account.padStart(4, "0");
      } else if (account.length > 4) {
        account = account.slice(-4);
      }

      // 4. Vytvoř tělo ACK zprávy přesně podle specifikace
      const ackBody = `ACK${seq}${receiver}${line}#${account}`;

      // 5. Vypočítej délku těla (4 číslice) a CRC
      const lenStr = pad(ackBody.length, 4);
      const crc = siaCRC(ackBody).toUpperCase();

      // 6. Sestav kompletní ACK s CRLF na začátku i konci
      const finalAck = `\r\n${lenStr}${ackBody}${crc}\r\n`;

      // 7. Převeď na Buffer v ASCII kódování
      const ackBuffer = Buffer.from(finalAck, 'ascii');

      // Debug logging
      if (node) {
        node.debug(`ACK components:
          SEQ: ${seq}
          RCV: ${receiver}
          LINE: ${line}
          ACC: ${account}
          BODY: ${ackBody}
          LEN: ${lenStr}
          CRC: ${crc}
          FINAL: ${ackBuffer.toString('hex')}
          LENGTH: ${ackBuffer.length}`);
      }

      // Ověř přesnou délku 26 bajtů
      if (!validateAckLength(ackBuffer)) {
        throw new Error(`Invalid ACK length: ${ackBuffer.length} bytes`);
      }

      return ackBuffer;
    } catch (err) {
      if (node) node.error(`Error creating ACK: ${err.message}`);
      throw err;
    }
  }

  /**
   * Odešle ACK zprávu s vypnutým Naglovým algoritmem
   */
  function sendAck(socket, ackBuffer, node) {
    if (!socket || !socket.writable) {
      if (node) node.warn("Socket není připraven pro odeslání ACK");
      return;
    }

    try {
      socket.setNoDelay(true);

      if (!validateAckLength(ackBuffer)) {
        throw new Error(`Invalid ACK length before send: ${ackBuffer.length}`);
      }

      if (node && node.debug) {
        node.debug(`Sending ACK: ${ackBuffer.toString('hex')} (${ackBuffer.length} bytes)`);
      }

      socket.write(ackBuffer);
    } catch (err) {
      if (node) node.error(`Error sending ACK: ${err.message}`);
      throw err;
    }
  }

  /**
   * Sestaví SIA Inquiry polling dotaz dle DC-09: I<account>,00,00\r\n
   */
  function createInquiryMessage(account, seq = "00") {
    // Účet vždy 3–16 HEX znaků, použij celý trimmed/uppercase z konfigurace
    let acc = (account || "").toString().toUpperCase().replace(/[^0-9A-F]/g, "");
    if (acc.length < 3) acc = acc.padStart(3, "0");
    // Sekvence zde vždy "00", případně by šla inkrementovat
    return `I${acc},${seq},00\r\n`;
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

    // Trim a validace účtu v konfiguraci
    if (!cfg.panelPort || !cfg.account) {
      node.error("Chybí povinné konfigurační hodnoty (port nebo account)");
      node.status({fill:"red", shape:"ring", text:"neplatná konfigurace"});
      return;
    }
    cfg.account = cfg.account.toString().trim().toUpperCase().replace(/[^0-9A-F]/g, "");
    if (cfg.account.length < 3) {
      node.error("Account musí být nejméně 3 hex znaky.");
      node.status({fill:"red", shape:"ring", text:"neplatný účet"});
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
      const pollingType = cfg.pollingType || "inquiry";
      if (interval > 0) {
        heartbeatTimer = setInterval(() => {
          sockets.forEach(socket => {
            if (socket.writable) {
              if (pollingType === "inquiry") {
                // Správný SIA polling dotaz
                socket.write(createInquiryMessage(cfg.account));
                node.debug(`Sent INQUIRY polling: ${createInquiryMessage(cfg.account).replace(/\r\n$/, "")}`);
              } else {
                // fallback staré "HEARTBEAT"
                socket.write("HEARTBEAT");
                node.debug("Sent legacy HEARTBEAT");
              }
            }
          });
          setStatus("polling sent", "blue", "ring");
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
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);

      if (sockets.length >= MAX_CONNECTIONS) {
        socket.destroy();
        node.warn("Překročen maximální počet spojení");
        return;
      }

      sockets.push(socket);
      setStatus("client connected");

      socket.on("data", function(data) {
        const rawStr = data.toString().trim(); // DŮLEŽITÉ: trim!
        node.debug(`Received raw data: ${rawStr}`);

        try {
          // Zpracuj handshake a běžné zprávy
          const ackBuffer = createAckMessage(rawStr, node);

          if (socket && socket.writable) {
            sendAck(socket, ackBuffer, node);
          }

          // Detekuj typ zprávy a odešli odpovídající payload
          if (rawStr.match(/^([FD]#?[0-9A-Za-z]+)/)) {
            // Handshake
            setStatus("handshake");
            let acc = "";
            const m = rawStr.match(/^([FD]#?)([0-9A-Za-z]+)/);
            if (m && m[2]) acc = m[2].replace(/[^0-9A-Za-z]/g, "");
            node.send([{
              payload: {
                type: "handshake",
                ack: ackBuffer,
                raw: rawStr,
                account: acc,
                timestamp: new Date().toISOString()
              }
            }, null]);
            // Po handshake pošli polling ihned (doporučené pro Galaxy)
            socket.write(createInquiryMessage(cfg.account));
            node.debug(`Immediately sent INQUIRY after handshake: ${createInquiryMessage(cfg.account).replace(/\r\n$/, "")}`);
          } else {
            // Pokus se zpracovat jako SIA zprávu
            const parsed = parseSIA(
              rawStr,
              cfg.siaLevel,
              cfg.encryption,
              cfg.encryptionKey,
              cfg.encryptionHex
            );

            if (parsed.valid) {
              node.debug({
                event: "message",
                parsed: parsed,
                ack: ackBuffer
              });

              node.send([{
                payload: {
                  ...parsed,
                  type: "sia_message",
                  ack: ackBuffer,
                  raw: rawStr,
                  timestamp: new Date().toISOString()
                }
              }, null]);
            } else {
              node.warn(`Invalid message received: ${rawStr}`);
            }
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

    // Start server on init
    startServer();

    // Cleanup on node close
    this.on("close", function(removed, done) {
      stopServer(() => {
        if (removed) {
          // Additional cleanup if needed
        }
        done();
      });
    });
  }

  // Register node type
  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
