/**
 * Galaxy SIA Out Node
 * Connects to the panel and sends SIA DC-09 commands built by sia-command.
 */
module.exports = function(RED) {
  const net     = require("net");
  const siaCmd  = require("./lib/sia-command");

  function GalaxySiaOutNode(config) {
    RED.nodes.createNode(this, config);
    const cfg  = RED.nodes.getNode(config.config);
    const node = this;
    let client = null;

    // Ensure TCP connection to panel
    function ensureConnection(cb) {
      if (client && !client.destroyed) return cb();
      client = net.connect(cfg.panelPort, cfg.panelIP, cb);
      client.on("error", err => node.error("Connection error: "+err.message));
    }

    this.on("input", msg => {
      if (!cfg) {
        node.error("Missing config node");
        return;
      }
      ensureConnection(() => {
        const cmdName = msg.command;
        const params  = msg.params || [];
        if (!siaCmd[cmdName]) {
          node.error("Unknown command: "+cmdName);
          return;
        }
        const cmd = siaCmd[cmdName](cfg.account, ...params);
        client.write(cmd, "ascii");
        node.send({ payload: cmd });
      });
    });

    this.on("close", done => {
      if (client) client.end(done);
      else done();
    });
  }

  RED.nodes.registerType("galaxy-sia-out", GalaxySiaOutNode);
};
