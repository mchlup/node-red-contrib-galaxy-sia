const net      = require("net");
const parseSIA = require("./lib/sia-parser");

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
  const crc  = parseSIA.siaCRC(body);
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
        node.send([{ payload: { type:"handshake", ack: ackStr, raw: rawStr } }, null]);
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
        const ackEv = buildAckPacket(cfg.account, parsed.seq);
        msgMain = { payload: { ...parsed, ack: ackEv, raw: rawStr } };
        // Odeslat ACK s parsed.seq
        sendAck(socket, ackEv);
      }

      // Debug výstup (2. port)
      const msgDebug = {
        payload: {
          raw: rawStr,
          parsed: parsed,
          ack: msgMain && msgMain.payload.ack ? msgMain.payload.ack : undefined
        }
      };

      node.status({fill:"green",shape:"dot",text:parsed.valid ? "msg OK" : "invalid"});
      node.send([msgMain, msgDebug]);
    });

    socket.on("error", err => {
      node.error("Socket error: " + err.message);
    });
  });

  server.listen(cfg.panelPort, () => {
    node.status({fill:"green",shape:"ring",text:"listening"});
  });

  this.on("close", done => {
    server.close(done);
  });
}

module.exports = function(RED) {
  const parseSia = require('../lib/sia-parser');
  const siaCRC = parseSia.siaCRC;

  function GalaxySiaInNode(config) {
    RED.nodes.createNode(this, config);
    const cfgNode = RED.nodes.getNode(config.config);
    const node = this;
    let buffer = '';

    // subscribe to raw data
    cfgNode.on('data', chunk => {
      buffer += chunk.toString('ascii');
      let idx;
      while ((idx = buffer.indexOf('\r')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleMessage(raw);
      }
    });

    function handleMessage(rawStr) {
      // Handshake
      const hs = rawStr.match(/^([FD]#?[0-9A-Za-z]+).*$/);
      if (hs) {
        cfgNode.socket.write(hs[1], 'ascii');
        return;
      }

      const parsed = parseSia.parse(rawStr);
      if (!parsed) return;

      if (parsed.valid) {
        // SIA-DC09 ACK
        const seq = parsed.seq || '00';
        const rcv = parsed.rcv || 'R0';
        const lpref = parsed.lpref || 'L0';
        const func = '\x06';
        const body = `${seq}${rcv}${lpref}#${cfgNode.account}`;
        const len = pad((func + body).length, 4);
        const crc = siaCRC(func + body);
        const ack = `\r\n${len}${func}${body}${crc}\r\n`;
        cfgNode.socket.write(ack, 'ascii');
        node.send(parsed);
      } else {
        node.warn(`Invalid CRC for message: ${rawStr}`);
      }
    }

    this.on('close', done => done());
  }

  RED.nodes.registerType('galaxy-sia-in', GalaxySiaInNode);
};
