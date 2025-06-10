module.exports = function(RED) {
  const net      = require("net");
  const parseSIA = require("./lib/sia-parser");
  const siaCRC   = parseSIA.siaCRC;
  const pad      = parseSIA.pad;

  function getAckString(cfg, rawStr) {
    switch (cfg.ackType) {
      case "A_CRLF":              return "A\r\n";
      case "A":                   return "A";
      case "ACK_CRLF":            return "ACK\r\n";
      case "ACK":                 return "ACK";
      case "ECHO":                return rawStr;
      case "ECHO_TRIM_END":       return rawStr.slice(0, -1);
      case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
      case "ECHO_TRIM_BOTH":      return rawStr.trim();
      case "CUSTOM":              return cfg.ackCustom || "";
      case "SIA_PACKET":
      default:
        return buildAckPacket(cfg.account);
    }
  }

  function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
    const body = `ACK${seq}${rcv}${lpref}#${account}`;
    const len  = pad(body.length, 4);
    const crc  = siaCRC(body);
    return `\n${crc}${len}${body}\r`;
  }

  function sendAck(socket, ackStr) {
    // Pokud začíná LF = binární SIA paket, posíláme jako Buffer
    if (ackStr.startsWith("\n")) {
      socket.write(Buffer.from(ackStr, "binary"));
    } else {
      socket.write(ackStr);
    }
  }

  // ───────────────────────────────── Node implementation
  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;

    const server = net.createServer((socket) => {
      socket.on("data", (raw) => {
        const rawStr = raw.toString();
        const handshakeMatch = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);

        // ── Handshake
        if (handshakeMatch) {
          const ackStr = getAckString(cfg, rawStr);
          sendAck(socket, ackStr);

          node.send([
            null,
            {
              payload: {
                type: "handshake",
                raw: rawStr,
                ackRaw: ackStr,
                timestamp: new Date().toISOString(),
              },
            },
          ]);
          return;
        }

        // ── Standardní SIA zpráva
        const parsed = parseSIA(
          rawStr,
          cfg.siaLevel,
          cfg.encryption,
          cfg.encryptionKey,
          cfg.encryptionHex
        );

        let msgMain = null;
        if (parsed?.valid && (!cfg.discardTestMessages || parsed.code !== "DUH")) {
          msgMain = { payload: parsed };

          // ACK na každou validní zprávu
          const ackStr = buildAckPacket(cfg.account);
          sendAck(socket, ackStr);
        }

        // Debug výstup
        const msgDebug = {
          payload: {
            type: "in",
            timestamp: new Date().toISOString(),
            remoteAddress: socket.remoteAddress,
            raw: rawStr,
          },
        };
        node.send([msgMain, msgDebug]);
      });
    }).listen(cfg.panelPort);

    this.on("close", (done) => server.close(done));
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
