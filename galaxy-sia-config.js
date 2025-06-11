/**
 * Galaxy SIA Config Node with auto-reconnect/back-off
 */
module.exports = function(RED) {
  const net = require("net");

  function GalaxySiaConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.ip = config.ip;
    node.port = config.port;
    node.account = config.account;
    node.reconnectDelay = 1000;

    // store PIN securely
    node.pin = this.credentials.pin;

    let socket;

    function connect() {
      socket = net.createConnection({ host: node.ip, port: node.port }, () => {
        node.log('Connected to Galaxy panel');
        node.status({ fill: 'green', shape: 'dot', text: 'connected' });
        node.reconnectDelay = 1000; // reset delay
      });

      socket.on('data', data => {
        node.emit('data', data);
      });

      socket.on('error', err => {
        node.error(`Connection error: ${err}`);
      });

      socket.on('close', () => {
        node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
        setTimeout(connect, node.reconnectDelay);
        node.reconnectDelay = Math.min(node.reconnectDelay * 2, 60000);
      });

      node.socket = socket;
    }

    connect();

    this.on('close', done => {
      if (socket) socket.end();
      done();
    });
  }

  RED.nodes.registerType('galaxy-sia-config', GalaxySiaConfigNode, {
    credentials: { pin: { type: 'password' } }
  });
};
