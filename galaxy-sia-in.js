module.exports = function(RED) {
  const net = require("net");
  const parseSIA = require("./lib/sia-parser");
  const { siaCRC, pad } = require("./lib/sia-parser");

  // 🔽 sem vlož funkci getAckString
  function getAckString(cfg, rawStr) {
    switch (cfg.ackType) {
      case "A_CRLF": return "A\r\n";
      case "A": return "A";
      case "ACK_CRLF": return "ACK\r\n";
      case "ACK": return "ACK";
      case "ECHO": return rawStr;
      case "ECHO_TRIM_END": return rawStr.slice(0, -1);
      case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
      case "ECHO_TRIM_BOTH": return rawStr.trim();
      case "CUSTOM": return cfg.ackCustom || "";
      case "SIA_PACKET": return buildAckPacket(cfg.account);
      default: return "A\r\n";
    }
  }

  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    const body = `ACK${seq}${rcv}${lpref}#${account}`;
    const len = pad(body.length, 4);
    const crc = siaCRC(body);
    return `\n${crc}${len}${body}\r`;
  }

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    this.configNode = RED.nodes.getNode(config.config);
    const cfg = this.configNode;
    const node = this;

    const server = net.createServer(socket => {
      socket.on("data", raw => {
        const rawStr = raw.toString();
        const handshakeMatch = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);

        if (handshakeMatch) {
          const ackPacket = buildAckPacket(cfg.account);
          socket.write(ackPacket);
          node.send([null, {
            payload: {
              type: 'handshake',
              raw: rawStr,
              ackRaw: ackPacket,
              timestamp: new Date().toISOString()
            }
          }]);
          return;
        }

        // --- Standardní SIA zpráva ---
        const parsed = parseSIA(rawStr, cfg.siaLevel, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);

        let msgMain = null;
        if (parsed && parsed.valid) {
          if (!cfg.discardTestMessages || parsed.code !== "DUH") {
            msgMain = { payload: parsed };
            // Odeslat SIA ACK po každé validní zprávě!
            const ackPacket = buildAckPacket(cfg.account);
            socket.write(ackPacket);
          }
        }

        // Debug výstup
        const msgDebug = {
          payload: {
            type: 'in',
            timestamp: new Date().toISOString(),
            remoteAddress: socket.remoteAddress,
            raw: rawStr
          }
        };

        node.send([msgMain, msgDebug]);
      });
    }).listen(cfg.panelPort);

    this.on("close", done => server.close(done));
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
