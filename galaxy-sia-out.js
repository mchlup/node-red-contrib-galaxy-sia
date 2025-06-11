module.exports = function(RED) {
  const siaCmd = require('./lib/sia-command');

  function GalaxySiaOutNode(config) {
    RED.nodes.createNode(this, config);
    const cfgNode = RED.nodes.getNode(config.config);
    const node = this;

    this.on('input', msg => {
      const socket = cfgNode.socket;
      if (!socket || socket.destroyed) {
        node.error('Not connected');
        return;
      }
      // msg.command musí být validní klíč v siaCmd
      if (siaCmd[msg.command]) {
        const cmdStr = siaCmd[msg.command](cfgNode.account, ...(msg.params||[]));
        socket.write(cmdStr, 'ascii');
        node.log(`Sent ${msg.command}`);
      } else {
        node.error(`Unknown command: ${msg.command}`);
      }
    });

    this.on('close', done => done());
  }

  RED.nodes.registerType('galaxy-sia-out', GalaxySiaOutNode);
};
