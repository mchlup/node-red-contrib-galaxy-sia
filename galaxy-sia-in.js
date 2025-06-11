// galaxy-sia-in.js
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
    // pokud začíná novým řádkem, posíláme binárně
    if (ackStr.startsWith("\n")) {
      socket.write(Buffer.from(ackStr, "binary"));
    } else {
      socket.write(ackStr);
    }
  }

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    const cfg  = RED.nodes.getNode(config.config);
    const node = this;

    const server = net.createServer(socket => {
      socket.on("data", raw => {
        const rawStr = raw.toString();

        // *** DEBUG RAW ***
        if (cfg.debug) {
          node.debug("SIA RAW: " + rawStr);
        }

        // Handshake: D#... nebo F#...
        const h = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);
        if (h) {
          const ackStr = getAckString(cfg, h[1]);
          sendAck(socket, ackStr);
          node.status({fill:"green",shape:"dot",text:"handshake"});
          node.send([{ payload: { type:"handshake" } }, null]);
          return;
        }

        // Standardní SIA zpráva
        const parsed = parseSIA(
          rawStr,
          cfg.siaLevel,
          cfg.encryption,
          cfg.encryptionKey,
          cfg.encryptionHex
        );

        // *** DEBUG PARSED ***
        if (cfg.debug) {
          node.debug("SIA PARSED: " + JSON.stringify(parsed));
        }

        // Ignorovat jiné účty
        if (parsed.account !== cfg.account) {
          node.warn(`SIA: Ignored message with account ${parsed.account}`);
          return;
        }

        let msgMain = null;
        if (parsed.valid && (!cfg.discardTestMessages || parsed.code !== "DUH")) {
          msgMain = { payload: parsed };
          // Odeslat ACK s parsed.seq
          const ackEv = buildAckPacket(cfg.account, parsed.seq);
          sendAck(socket, ackEv);
        }

        // Debug výstup (2. port)
        const msgDebug = {
          payload: {
            type:          parsed.valid ? "in" : "raw",
            timestamp:     new Date().toISOString(),
            remoteAddress: socket.remoteAddress,
            raw:           rawStr
          }
        };

        node.send([ msgMain, msgDebug ]);
      });
    }).listen(cfg.panelPort);

    this.on("close", done => server.close(done));
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
