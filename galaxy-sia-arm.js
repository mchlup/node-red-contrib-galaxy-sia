module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function ArmNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;
    this.partition = config.partition;
    this.delay = config.delay;

    this.on('input', () => {
      const cmd = siaCmd.arm(cfg.account, this.partition, cfg.pin);
      cfg.socket.write(cmd, 'ascii');
      node.log(`Arming partition ${this.partition}`);
      node.send({ payload: 'armed' });
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType("galaxy-sia-arm", ArmNode, {
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
      return this.name || "galaxy-sia-arm";
    },
    paletteLabel: "arm"
  });
};
