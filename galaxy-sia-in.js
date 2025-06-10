module.exports = function(RED) {
  const net = require("net");
  const parseSIA = require("./lib/sia-parser");

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    this.configNode = RED.nodes.getNode(config.config);
    const cfg = this.configNode;
    const node = this;

    const server = net.createServer(socket => {
      socket.on("data", raw => {
        const rawStr = raw.toString();
        // --- Handshake detection: "F#account" (s volitelnými neznámými znaky)
        const handshakeMatch = rawStr.match(/^F#?[0-9A-Za-z]+/);

        if (handshakeMatch) {
          // Odpověď podle SIA DC-09
          socket.write("A\r\n");

          // Debug výstup o handshaku (pouze na druhý výstup)
          const msgDebug = {
            payload: {
              type: 'handshake',
              timestamp: new Date().toISOString(),
              remoteAddress: socket.remoteAddress,
              raw: rawStr,
              ack: 'A'
            }
          };
          node.send([null, msgDebug]);
          return; // Zastavit další zpracování, handshake není SIA event
        }

        // --- Standardní SIA zpráva ---
        const parsed = parseSIA(rawStr, cfg.siaLevel, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);

        // Hlavní výstup: pouze validní zprávy, pokud nejsou ignorovány test messages
        let msgMain = null;
        if (parsed && parsed.valid) {
          if (!cfg.discardTestMessages || parsed.code !== "DUH") {
            msgMain = { payload: parsed };
          }
        }

        // Debug výstup: vždy raw string + info
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
