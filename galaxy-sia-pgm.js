module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function PgmNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;
    this.output = config.output;
    this.action = config.action; // 'on' or 'off'

    this.on('input', () => {
      const actCode = this.action === 'on' ? '01' : '00';
      const cmd = siaCmd.pgm(cfg.account, this.output, actCode);
      cfg.socket.write(cmd, 'ascii');
      node.log(`PGM ${this.action} output ${this.output}`);
      node.send({ payload: `pgm ${this.action} ${this.output}` });
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType("galaxy-sia-pgm", PgmNode, {
    category: "Galaxy SIA Connector",  // Změna kategorie
    defaults: {
      config: { type: 'galaxy-sia-config', required: true },
      output: { value: '1' },
      action: { value: 'on' }
    },
    color: "#a6d7a8",
    inputs: 1,
    outputs: 1,
    icon: "font-awesome/fa-shield",
    label: function() {
      return this.name || "galaxy-sia-pgm";
    },
    paletteLabel: "pgm"
  });
};
