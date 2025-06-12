module.exports = function(RED) {
  const net = require("net");
  const siaCmd = require("./lib/sia-command");

  function GalaxySiaOutNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    
    // Get the config node
    const cfg = RED.nodes.getNode(config.config);
    if (!cfg) {
      node.error("No configuration node found");
      node.status({fill:"red", shape:"ring", text:"missing config"});
      return;
    }

    // Validate required configuration
    if (!cfg.panelIP || !cfg.panelPort) {
      node.error("Missing required configuration (IP or Port)");
      node.status({fill:"red", shape:"ring", text:"invalid config"});
      return;
    }

    let client = null;

    // Ensure TCP connection to panel with better error handling
    function ensureConnection(cb) {
      try {
        if (client && !client.destroyed) return cb();
        
        client = net.connect(cfg.panelPort, cfg.panelIP, () => {
          node.status({fill:"green", shape:"dot", text:"connected"});
          cb();
        });

        client.on("error", err => {
          node.error("Connection error: " + err.message);
          node.status({fill:"red", shape:"ring", text:"error"});
        });

        client.on("close", () => {
          node.status({fill:"yellow", shape:"ring", text:"disconnected"});
        });

      } catch (err) {
        node.error("Failed to establish connection: " + err.message);
        node.status({fill:"red", shape:"ring", text:"connection failed"});
      }
    }

    this.on("input", msg => {
      if (!cfg) {
        node.error("Missing config node");
        return;
      }

      const cmdName = msg.command;
      const params = msg.params || [];

      if (!cmdName) {
        node.error("No command specified in message");
        return;
      }

      if (!siaCmd[cmdName]) {
        node.error("Unknown command: " + cmdName);
        return;
      }

      ensureConnection(() => {
        try {
          const cmd = siaCmd[cmdName](cfg.account, ...params);
          client.write(cmd, "ascii");
          node.status({fill:"green", shape:"dot", text:"sent"});
          node.send({ payload: cmd });
        } catch (err) {
          node.error("Error sending command: " + err.message);
          node.status({fill:"red", shape:"ring", text:"send error"});
        }
      });
    });

    this.on("close", done => {
      if (client) {
        try {
          client.end(() => {
            client.destroy();
            client = null;
            node.status({});
            done();
          });
        } catch (err) {
          node.error("Error closing connection: " + err.message);
          client = null;
          done();
        }
      } else {
        done();
      }
    });
  }

  RED.nodes.registerType("galaxy-sia-out", GalaxySiaOutNode, {
    category: "network",
    defaults: {
      name: { value: "" },
      config: { type: "galaxy-sia-config", required: true }
    }
  });
};
