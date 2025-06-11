module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function DisarmNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;

    this.partition = config.partition;
    this.on('input', () => {
      const cmd = siaCmd.disarm(cfg.account, this.partition, cfg.pin);
      cfg.socket.write(cmd, 'ascii');
      node.log(`Disarming partition ${this.partition}`);
      node.send({ payload: 'disarmed' });
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType('galaxy-sia-disarm', DisarmNode, {
    defaults: {
      config: { type: 'galaxy-sia-config', required: true },
      partition: { value: '1' }
    }
  });
};
