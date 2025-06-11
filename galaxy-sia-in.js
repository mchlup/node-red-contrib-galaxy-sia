const net = require("net");
const parseSIA = require("./lib/sia-parser");

const pad = parseSIA.pad;

// Management spojení a heartbeat
const HEARTBEAT_PAYLOAD = "HEARTBEAT";
const HEARTBEAT_INTERVAL_DEFAULT = 60; // v sekundách

function getAckString(cfg, rawStr) {
  switch (cfg.ackType) {
    case "A_CRLF":              return "A\r\n";
    case "A":                   return "A";
    case "ACK_CRLF":            return "ACK\r\n";
    case "ACK":                 return "ACK";
    case "ECHO":                return rawStr;
    case "ECHO_TRIM_END":       return rawStr.slice(0, -1);
    case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
    case "ECHO_TRIM_BOTH":      return rawStr.trim();
    case "CUSTOM":              return cfg.ackCustom || "";
    case "SIA_PACKET":
    default:
      return buildAckPacket(cfg.account);
  }
}

function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
  const body = `ACK${seq}${rcv}${lpref}#${account}`;
  const len = pad(body.length, 4);
  const crc = parseSIA.siaCRC(body);
  return `\n${crc}${len}${body}\r`;
}

function sendAck(socket, ackStr) {
  if (ackStr.startsWith("\n")) {
    socket.write(Buffer.from(ackStr, "binary"));
  } else {
    socket.write(ackStr);
  }
}

function GalaxySIAInNode(config) {
  RED.nodes.createNode(this, config);
  const cfg = RED.nodes.getNode(config.config);
  const node = this;

  let server;
  let sockets = [];
  let heartbeatTimer = null;

  // Stav spojení
  function setStatus(text, color = "green", shape = "dot") {
    node.status({ fill: color, shape: shape, text: text });
  }

  // Heartbeat odesílání
  function startHeartbeat() {
    stopHeartbeat();
    const interval = Number(cfg.heartbeatInterval) || HEARTBEAT_INTERVAL_DEFAULT;
    if (interval > 0) {
      heartbeatTimer = setInterval(() => {
        sockets.forEach(socket => {
          if (socket.writable) {
            socket.write(HEARTBEAT_PAYLOAD);
          }
        });
        setStatus("heartbeat sent", "blue", "ring");
      }, interval * 1000);
    }
  }
  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function cleanupSockets() {
    sockets = sockets.filter(s => !s.destroyed);
  }

  function handleSocket(socket) {
    sockets.push(socket);
    setStatus("client connected");

    socket.on("data", raw => {
      const rawStr = raw.toString();

      if (cfg.debug) node.debug("SIA RAW: " + rawStr);

      const h = rawStr.match(/^([FD]#?[0-9A-Za-z]+)[^\r\n]*/);
      if (h) {
        const ackStr = getAckString(cfg, h[1]);
        sendAck(socket, ackStr);
        setStatus("handshake");
        node.send([{ payload: { type: "handshake", ack: ackStr, raw: rawStr } }, null]);
        return;
      }

      const parsed = parseSIA(
        rawStr,
        cfg.siaLevel,
        cfg.encryption,
        cfg.encryptionKey,
        cfg.encryptionHex
      );

      if (cfg.debug) node.debug("SIA PARSED: " + JSON.stringify(parsed));

      if (parsed.account !== cfg.account) {
        node.warn(`SIA: Ignored message with account ${parsed.account}`);
        return;
      }

      let msgMain = null;
      if (parsed.valid && (!cfg.discardTestMessages || parsed.code !== "DUH")) {
        const ackEv = buildAckPacket(cfg.account, parsed.seq);
        msgMain = { payload: { ...parsed, ack: ackEv, raw: rawStr } };
        sendAck(socket, ackEv);
      }

      const msgDebug = {
        payload: {
          raw: rawStr,
          parsed: parsed,
          ack: msgMain && msgMain.payload.ack ? msgMain.payload.ack : undefined
        }
      };

      setStatus(parsed.valid ? "msg OK" : "invalid");
      node.send([msgMain, msgDebug]);
    });

    socket.on("close", () => {
      setStatus("client disconnected", "yellow", "ring");
      cleanupSockets();
    });

    socket.on("error", err => {
      node.error("Socket error: " + err.message);
      setStatus("socket error", "red", "ring");
    });
  }

  function startServer() {
    if (server) return;
    server = net.createServer(handleSocket);
    server.on("error", err => {
      node.error("Server error: " + err.message);
      setStatus("server error", "red", "dot");
    });
    server.listen(cfg.panelPort, () => {
      setStatus("listening");
    });
    startHeartbeat();
  }

  function stopServer(done) {
    stopHeartbeat();
    if (server) {
      server.close(done);
      server = null;
    } else {
      if (done) done();
    }
    sockets.forEach(s => s.destroy());
    sockets = [];
    setStatus("stopped", "grey", "ring");
  }

  // Automatické spuštění serveru a reconnect při chybě
  startServer();

  this.on("close", done => {
    stopServer(done);
  });
}

module.exports = function(RED) {
  RED.nodes.registerType("galaxy-sia-in", GalaxySIAInNode);
};
