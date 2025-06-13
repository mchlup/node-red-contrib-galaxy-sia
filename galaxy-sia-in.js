// galaxy-sia-in.js
// Node-RED custom node: Galaxy Dimension SIA DC-09 connector
// - Správné odesílání 14b ACK (CRC) pro handshake i eventy
// - Inquiry polling pro získání stavových zpráv
// - Keepalive (heartbeat) na základě příchozích Null zpráv
// - Dynamické mapování eventů z externího JSON

module.exports = function(RED) {
    const DEBUG = true;
    const net = require("net");
    const fs = require("fs");
    const parseSIA = require("./lib/sia-parser");
    const siaCRC = parseSIA.siaCRC;
    const pad = parseSIA.pad;

    // Konstanty
    const MAX_CONNECTIONS = 20;
    const POLLING_INTERVAL_DEFAULT = 10;  // sec
    const POLLING_SEQ_START = 1;
    const POLLING_SEQ_MAX = 9999;
    const HEARTBEAT_INTERVAL_DEFAULT = 60; // sec
    const ACK_BODY_LENGTH = 14;
    const ACCOUNT_PAD_LENGTH = 4;
    const HEARTBEAT_PAYLOAD = "\r\n0000#\r\n";  // Null zpráva od panelu není odesílána, ale tento payload lze použít

    function debugLog(node, message, data) {
        if (DEBUG) {
            node.debug(message + (data ? `: ${JSON.stringify(data)}` : ''));
        }
    }

    // Sestaví SIA DC-09 ACK paket: \r\n + 4B len + 14B body + 4B CRC + \r\n
    function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
        const acct = account.toString().padStart(ACCOUNT_PAD_LENGTH, '0').slice(-ACCOUNT_PAD_LENGTH);
        const ackBody = `ACK${seq}${rcv}${lpref}#${acct}`;
        if (ackBody.length !== ACK_BODY_LENGTH) {
            console.warn(`ACK BODY length is NOT ${ACK_BODY_LENGTH}: ${ackBody.length} [${ackBody}]`);
        }
        const lenStr = pad(ACK_BODY_LENGTH, 4);
        const crc = siaCRC(ackBody);
        const packet = `\r\n${lenStr}${ackBody}${crc}\r\n`;
        debugLog(null, 'Built ACK packet', { packet, bytes: packet.length });
        return packet;
    }

    // Inquiry: I<account>,<seq4>,00\r\n
    function buildInquiryPacket(account, seq) {
        const seqStr = seq.toString().padStart(4, '0');
        return `I${account},${seqStr},00\r\n`;
    }

    // Generování ACK string podle typu cfg.ackType
    function getAckString(cfg, rawStr, node) {
        // handshake
        if (/^[FD]#?\d+/.test(rawStr)) {
            try {
                const account = rawStr.split('#')[1].replace(/\D/g, '');
                return buildAckPacket(account, "00");
            } catch (err) {
                if (node) node.error(`Handshake ACK error: ${err.message}`);
                return "ACK\r\n";
            }
        }
        switch (cfg.ackType) {
            case "SIA_PACKET":
                try {
                    const parsed = parseSIA(rawStr);
                    if (parsed.valid) {
                        return buildAckPacket(parsed.account, parsed.seq || "00");
                    }
                } catch (e) {
                    if (node) node.warn(`SIA_PACKET ACK error: ${e.message}`);
                }
                return buildAckPacket(cfg.account, "00");
            case "A_CRLF":            return "A\r\n";
            case "A":                 return "A";
            case "ACK_CRLF":         return "ACK\r\n";
            case "ACK":              return "ACK";
            case "ECHO":             return rawStr;
            case "ECHO_TRIM_END":    return rawStr.slice(0, -1);
            case "ECHO_STRIP_NONPRINT": return rawStr.replace(/[\x00-\x1F\x7F]+$/g, "");
            case "ECHO_TRIM_BOTH":   return rawStr.trim();
            case "CUSTOM":           return cfg.ackCustom || "";
            default:
                if (node) node.warn(`Unknown ackType ${cfg.ackType}, defaulting to ACK\r\n`);
                return "ACK\r\n";
        }
    }

    // Odeslání ACK na socket
    function sendAck(socket, ackStr, node) {
        if (!socket || !socket.writable) {
            if (node) node.warn("Socket not writable for ACK");
            return;
        }
        try {
            socket.write(Buffer.from(ackStr, 'ascii'));
            debugLog(node, `Sent ACK (${ackStr.length}B)`);
        } catch (e) {
            if (node) node.error(`sendAck error: ${e.message}`);
        }
    }

    // Načtení externího mapování eventů
    function loadDynamicMapping(path, node) {
        try {
            if (!path || !fs.existsSync(path)) return null;
            const data = fs.readFileSync(path, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            if (node) node.warn(`Mapping load error: ${e.message}`);
            return null;
        }
    }

    function GalaxySIAInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const cfg = RED.nodes.getNode(config.config);
        if (!cfg || !cfg.panelPort || !cfg.account) {
            node.error("Invalid configuration: panelPort/account missing");
            node.status({ fill: 'red', shape: 'ring', text: 'bad config' });
            return;
        }

        let server = null;
        let sockets = [];
        let heartbeatTimer = null;
        let inquirySeq = POLLING_SEQ_START;
        const mapping = loadDynamicMapping(cfg.mapFile, node);

        function setStatus(text, color='green', shape='dot') {
            node.status({ fill: color, shape: shape, text: text });
        }

        function startHeartbeat() {
            clearInterval(heartbeatTimer);
            const interval = Number(cfg.heartbeatInterval) || HEARTBEAT_INTERVAL_DEFAULT;
            if (interval>0) {
                heartbeatTimer = setInterval(() => {
                    sockets.forEach(s => { if (s.writable) s.write(HEARTBEAT_PAYLOAD); });
                    setStatus('heartbeat');
                }, interval*1000);
            }
        }
        function stopHeartbeat() { clearInterval(heartbeatTimer); }
        function cleanupSockets() { sockets = sockets.filter(s=>!s.destroyed); }

        function startPolling(socket) {
            clearInterval(socket.poller);
            const interval = Number(cfg.pollingInterval) || POLLING_INTERVAL_DEFAULT;
            socket.poller = setInterval(() => {
                if (socket.writable) {
                    const inq = buildInquiryPacket(cfg.account, inquirySeq);
                    socket.write(inq);
                    debugLog(node, 'Sent inquiry', { seq: inquirySeq });
                    inquirySeq = inquirySeq<POLLING_SEQ_MAX? inquirySeq+1 : POLLING_SEQ_START;
                }
            }, interval*1000);
            setStatus(`polling every ${interval}s`, 'blue','ring');
        }
        function stopPolling(socket) { clearInterval(socket.poller); }

        function handleSocket(socket) {
            if (sockets.length>=MAX_CONNECTIONS) { socket.destroy(); return; }
            sockets.push(socket); setStatus('connected');
            socket.on('data', data => {
                const raw = data.toString('ascii'); debugLog(node,'recv raw',raw);
                raw.split(/\r?\n/).filter(l=>l).forEach(line=>{
                    // Handshake
                    if (/^[FD]#?\d+/.test(line)) {
                        const ackStr = getAckString(cfg,line,node);
                        sendAck(socket, ackStr,node);
                        setStatus('handshake');
                        node.send({ payload:{ type:'handshake', raw:line, ack:ackStr, account:cfg.account, ts:new Date().toISOString() } });
                        startPolling(socket);
                        return;
                    }
                    // SIA event/status/null
                    let parsed;
                    try { parsed = parseSIA(line); } catch(e){ node.warn(`parse error ${e.message}`); return; }
                    if (parsed.valid) {
                        const ackStr = getAckString(cfg,line,node);
                        sendAck(socket,ackStr,node);
                        let payload = { ...parsed, raw: line, ack: ackStr, ts: new Date().toISOString() };
                        if (mapping && mapping[parsed.eventType]) payload.eventDesc = mapping[parsed.eventType];
                        node.send({ payload });
                    } else {
                        node.warn(`Invalid SIA packet: ${line}`);
                    }
                });
            });
            socket.on('close',()=>{ stopPolling(socket); setStatus('disconnected','yellow','ring'); cleanupSockets(); });
            socket.on('error',e=>{ stopPolling(socket); node.error(`sock err ${e.message}`); setStatus('sock error','red'); });
        }

        function startServer() {
            server = net.createServer(handleSocket);
            server.maxConnections = MAX_CONNECTIONS;
            server.listen(cfg.panelPort,()=>{ node.log(`Listening ${cfg.panelPort}`); setStatus('listening'); startHeartbeat(); });
            server.on('error',e=>{ node.error(`srv err ${e.message}`); setStatus('srv error','red'); });
        }
        function stopServer(done) {
            stopHeartbeat();
            server&&server.close(()=>{ sockets.forEach(s=>s.destroy()); sockets=[]; setStatus('stopped'); done&&done(); });
        }

        startServer();
        this.on('close',(removed,done)=>{ stopServer(done); });
    }

    RED.nodes.registerType("galaxy-sia-in",GalaxySIAInNode);
};
