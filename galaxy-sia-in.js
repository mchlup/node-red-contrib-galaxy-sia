module.exports = function(RED) {
  const net = require("net");
  const parseSIA = require("./lib/sia-parser");

  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    this.configNode = RED.nodes.getNode(config.config);
    const cfg = this.configNode;
    const server = net.createServer(socket => {
      socket.on("data", raw => {
        const parsed = parseSIA(raw.toString(), cfg.siaLevel);
        if (!parsed) return;
        if (cfg.discardTestMessages && parsed.code === "DUH") return;
        this.send({ payload: parsed });
      });
    }).listen(cfg.panelPort);
    this.on("close", done => server.close(done));
  }
  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
