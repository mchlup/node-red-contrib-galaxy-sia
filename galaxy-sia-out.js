module.exports = function(RED) {
  const net = require("net");
  const buildCommand = require("./lib/sia-command");

  function GalaxySIAOutNode(config) {
    RED.nodes.createNode(this, config);
    this.configNode = RED.nodes.getNode(config.config);
    const cfg = this.configNode;
    let client = null;

    function ensureConnection(cb) {
      if (client && !client.destroyed) return cb();
      client = net.connect(cfg.panelPort, cfg.panelIP, cb);
    }

    this.on("input", msg => {
      const c = msg.payload.command;
      const group = msg.payload.group;
      ensureConnection(() => {
        const cmd = buildCommand(cfg.account, c, group, cfg.encryption, cfg.encryptionKey, cfg.encryptionHex);
        client.write(cmd + "\r\n");
      });
    });

    this.on("close", done => {
      if (client) client.end(done);
      else done();
    });
  }
  RED.nodes.registerType("galaxy-sia-out", GalaxySIAOutNode);
};
