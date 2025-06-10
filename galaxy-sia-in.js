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
        const parsed = parseSIA(rawStr, cfg.siaLevel, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);

        // Hlavní výstup: parsed událost (pouze validní zprávy)
        // Debug výstup: vždy raw string a info
        let msgMain = null;
        if (parsed && parsed.valid) {
          if (!cfg.discardTestMessages || parsed.code !== "DUH") {
            msgMain = { payload: parsed };
          }
        }

        // Debug zpráva - vždy obsahuje typ události, raw data, čas atd.
        const msgDebug = {
          payload: {
            type: 'in',
            timestamp: new Date().toISOString(),
            remoteAddress: socket.remoteAddress,
            raw: rawStr
          }
        };

        // Odeslat na oba výstupy: [hlavní|null, debug]
        node.send([msgMain, msgDebug]);
      });
    }).listen(cfg.panelPort);

    this.on("close", done => server.close(done));
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
