const net = require('net');
const { createAckMessage, validateAckLength } = require('./lib/sia-ack');
const { parseSIA } = require('./lib/sia-parser');

// Default configuration
const HEARTBEAT_INTERVAL_DEFAULT = 60; // seconds

module.exports = function(RED) {
  function GalaxySIAInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Trim and validate account from config
    function normalizeAccount(acct) {
      if (!acct) return '';
      return String(acct).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    }
    const account = normalizeAccount(config.account);

    let server = null;
    let sockets = [];
    let heartbeatInterval = parseInt(config.heartbeatInterval, 10) || HEARTBEAT_INTERVAL_DEFAULT;
    let pollingType = config.pollingType === 'inquiry' ? 'inquiry' : 'heartbeat';
    let seq = 0;

    function getSeqStr() {
      // Sequence as two digit string (rollover at 99)
      const s = ('0' + (seq % 100)).slice(-2);
      seq = (seq + 1) % 100;
      return s;
    }

    function sendPolling(socket, lastHandshakeAccount) {
      if (pollingType === 'inquiry') {
        // Use last known account from handshake if available, else config
        const acct = lastHandshakeAccount || account;
        if (!acct) return;
        const pollingMsg = `I${acct},${getSeqStr()},00\r\n`;
        socket.write(pollingMsg);
        node.status({ fill: "blue", shape: "ring", text: "inquiry sent" });
      } else {
        socket.write("HEARTBEAT");
        node.status({ fill: "grey", shape: "ring", text: "heartbeat sent" });
      }
    }

    function startHeartbeat(socket, lastHandshakeAccount) {
      // Send first polling immediately on handshake
      sendPolling(socket, lastHandshakeAccount);

      // Then start interval
      socket._heartbeatTimer = setInterval(() => {
        if (socket.destroyed) return;
        sendPolling(socket, lastHandshakeAccount);
      }, heartbeatInterval * 1000);
    }

    function stopHeartbeat(socket) {
      if (socket._heartbeatTimer) {
        clearInterval(socket._heartbeatTimer);
        socket._heartbeatTimer = null;
      }
    }

    function closeAllSockets() {
      sockets.forEach((s) => {
        stopHeartbeat(s);
        s.destroy();
      });
      sockets = [];
    }

    function onSocketData(socket, data) {
      // Always trim input
      const rawStr = data.toString().trim();

      // Handshake detection: F#... or D#...
      const handshakeMatch = rawStr.match(/^([FD]#?[0-9A-Za-z]+)/);
      if (handshakeMatch) {
        // Normalize handshake account
        let handshakeAccount = '';
        const idx = rawStr.indexOf('#');
        if (idx !== -1) {
          handshakeAccount = rawStr.substring(idx + 1).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
        }
        // Compose and send ACK
        try {
          const ackBuffer = createAckMessage(rawStr);

          if (!validateAckLength(ackBuffer)) {
            throw new Error("Invalid ACK length");
          }
          socket.write(ackBuffer);

          // Start heartbeat/polling logic for this socket
          stopHeartbeat(socket);
          startHeartbeat(socket, handshakeAccount);

          // Send to first output: handshake event
          node.send([{
            payload: {
              type: "handshake",
              account: handshakeAccount,
              raw: rawStr,
              ack: ackBuffer.toString('ascii')
            }
          }, null]);
          node.status({ fill: "green", shape: "dot", text: "handshake ack" });
        } catch (err) {
          node.warn("Failed to generate/send ACK: " + err.message);
          node.status({ fill: "red", shape: "dot", text: "ACK error" });
        }
        return;
      }

      // Normal SIA message
      try {
        const parsed = parseSIA(rawStr, config.siaLevel, config.encryption, config.key, config.hex);
        // Always ACK immediately
        let ackBuffer;
        try {
          ackBuffer = createAckMessage(rawStr);
          if (validateAckLength(ackBuffer)) {
            socket.write(ackBuffer);
          }
        } catch (e) {
          // If failed to make ACK, just log
          node.warn("Failed to generate/send ACK for SIA: " + e.message);
        }
        // Only forward if parsed as valid
        if (parsed.valid) {
          node.send([{
            payload: {
              type: "sia_message",
              parsed,
              raw: rawStr,
              ack: ackBuffer ? ackBuffer.toString('ascii') : null,
              timestamp: Date.now()
            }
          }, null]);
        } else {
          node.warn("Invalid SIA message: " + rawStr + (parsed.error ? " (" + parsed.error + ")" : ""));
          node.status({ fill: "yellow", shape: "dot", text: "invalid sia" });
        }
      } catch (err) {
        node.warn("Error parsing SIA message: " + err.message);
        node.status({ fill: "red", shape: "dot", text: "parse error" });
      }
    }

    // TCP server setup
    server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true);
      sockets.push(socket);

      socket.on('data', (data) => onSocketData(socket, data));
      socket.on('close', () => {
        stopHeartbeat(socket);
        sockets = sockets.filter(s => s !== socket);
      });
      socket.on('error', (err) => {
        node.warn("Socket error: " + err.message);
        stopHeartbeat(socket);
        sockets = sockets.filter(s => s !== socket);
      });
    });

    server.listen(config.port, () => {
      node.status({ fill: "green", shape: "ring", text: "listening" });
    });

    server.on('error', (err) => {
      node.status({ fill: "red", shape: "dot", text: "server error" });
      node.error("Server error: " + err.message);
      closeAllSockets();
    });

    node.on('close', function() {
      if (server) {
        server.close();
        server = null;
      }
      closeAllSockets();
    });
  }

  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
