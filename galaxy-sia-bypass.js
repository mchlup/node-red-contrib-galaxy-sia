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

  RED.nodes.registerType('galaxy-sia-bypass', BypassNode, {
    defaults: {
      config: { type: 'galaxy-sia-config', required: true },
      zone: { value: '01' }
    }
  });
};
