/**
 * Galaxy SIA In Node
 * Listens for incoming SIA DC-09 connections from the panel,
 * parses messages and responds with the appropriate ACK.
 */
module.exports = function(RED) {
  const net     = require("net");
  const parseSia= require("./lib/sia-parser");
  const siaCRC  = parseSia.siaCRC;
  const pad     = parseSia.pad;

  function GalaxySiaInNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config); // musí vracet instanci správného typu
    const node = this;

    if (!cfg || !cfg.panelPort) {
      node.error("Missing configuration or panelPort");
      return;
    }

    const server = net.createServer(socket => {
      socket.on("data", rawBuf => {
        const rawStr = rawBuf.toString("ascii");

        // Handshake: D#xxxx or F#xxxx
        const hs = rawStr.match(/^([FD]#?[0-9A-Za-z]+).*$/);
        if (hs) {
          let ack = "";
          switch (cfg.ackType) {
            case "A_CRLF":    ack = "A\r\n"; break;
            case "A":         ack = "A";      break;
            case "ACK_CRLF":  ack = "ACK\r\n";break;
            case "ACK":       ack = "ACK";    break;
            case "CUSTOM":    ack = cfg.ackCustom||""; break;
            default:
              // Default SIA-DC09 packet ACK
              const body = `ACK00R0L0#${cfg.account}`;
              const len  = pad(body.length,4);
              const crc  = siaCRC(body);
              ack = `\r\n${len}${body}${crc}\r\n`;
          }
          socket.write(ack,"ascii");
          return;
        }

        // SIA-DC09 message parsing
        const msg = parseSia(rawStr, cfg.siaLevel, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);
        if (msg.account !== cfg.account) {
          return; // ignore other accounts
        }

        // Send ACK if valid
        if (msg.valid && (!cfg.discardTestMessages || msg.code !== "DUH")) {
          const seq   = msg.seq   || "00";
          const rcv   = msg.rcv   || "R0";
          const lpref = msg.lpref || "L0";
          const body  = `${seq}${rcv}${lpref}#${cfg.account}`;
          const len   = pad((`\x06` + body).length,4);
          const crc   = siaCRC(`\x06${body}`);
          const ack   = `\r\n${len}\x06${body}${crc}\r\n`;
          socket.write(ack,"ascii");
          node.send({ payload: { ...msg, ack, raw: rawStr } });
        } else {
          node.warn("Invalid or discarded message: "+rawStr);
        }
      });

      socket.on("error", err => {
        node.error("Socket error: "+err.message);
      });
    });

    server.listen(cfg.panelPort, () => {
      node.status({ fill:"green", shape:"dot", text:`listening:${cfg.panelPort}` });
    });

    this.on("close", done => server.close(done));
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySiaInNode);
};
