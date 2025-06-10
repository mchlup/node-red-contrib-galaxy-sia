module.exports = function(RED) {
  const net = require("net");
  const buildCommand = require("./lib/sia-command");

  function GalaxySIAOutNode(config) {
    RED.nodes.createNode(this, config);
    this.configNode = RED.nodes.getNode(config.config);
    const cfg = this.configNode;
    const node = this;
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

        // Debug výstup – vše co bylo odesláno
        const msgDebug = {
          payload: {
            type: 'out',
            timestamp: new Date().toISOString(),
            remoteAddress: cfg.panelIP,
            raw: cmd
          }
        };

        // V hlavním výstupu (index 0) nemusíš posílat nic, nebo potvrzení
        node.send([null, msgDebug]);
      });
    });

    this.on("close", done => {
      if (client) client.end(done);
      else done();
    });
  }
  RED.nodes.registerType("galaxy-sia-out", GalaxySIAOutNode);
};
