module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function RestoreNode(config) {
    RED.nodes.createNode(this, config);
    const cfg = RED.nodes.getNode(config.config);
    const node = this;
    this.zone = config.zone;

    this.on('input', () => {
      const cmd = siaCmd.restore(cfg.account, this.zone);
      cfg.socket.write(cmd, 'ascii');
      node.log(`Restoring zone ${this.zone}`);
      node.send({ payload: `restored ${this.zone}` });
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType('galaxy-sia-restore', RestoreNode, {
    defaults: {
      config: { type: 'galaxy-sia-config', required: true },
      zone: { value: '01' }
    }
  });
};
