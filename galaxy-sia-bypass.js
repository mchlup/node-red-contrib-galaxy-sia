module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function BypassNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;
    this.zone = config.zone;

    this.on('input', () => {
      const cmd = siaCmd.bypass(cfg.account, this.zone);
      cfg.socket.write(cmd, 'ascii');
      node.log(`Bypassing zone ${this.zone}`);
      node.send({ payload: `bypassed ${this.zone}` });
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType("galaxy-sia-bypass", BypassNode, {
    category: "Galaxy SIA Connector",  // Změna kategorie
    defaults: {
      name: { value: "" },
      config: { type: "galaxy-sia-config", required: true }
    },
    color: "#a6d7a8",
    inputs: 1,
    outputs: 1,
    icon: "font-awesome/fa-shield",
    label: function() {
      return this.name || "galaxy-sia-bypass";
    },
    paletteLabel: "bypass"
  });
};
