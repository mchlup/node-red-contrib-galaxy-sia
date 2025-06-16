// galaxy-sia-in.js
module.exports = function(RED) {
    const net = require("net");
    const parseSIA = require("./lib/sia-parser");
    const siaCRC = parseSIA.siaCRC;
    const pad = parseSIA.pad;

    const MAX_CONNECTIONS = 20;
    const ACK_BODY_LENGTH = 14;
    const ACCOUNT_PAD_LENGTH = 4;
    const POLLING_INTERVAL_DEFAULT = 10; // seconds
    const POLLING_SEQ_MAX = 9999;

    function buildAckPacket(account, seq = "00", rcv = "R0", lpref = "L0") {
        // Doplň účet na 4 znaky zleva nulami
        const acct = (account || "").toString().replace(/[^0-9A-Za-z]/g,"").padStart(ACCOUNT_PAD_LENGTH, '0').slice(-ACCOUNT_PAD_LENGTH);
        const ackBody = `ACK${seq}${rcv}${lpref}#${acct}`;
        if (ackBody.length !== ACK_BODY_LENGTH) {
            throw new Error(`ACK BODY length is NOT 14: ${ackBody.length} [${ackBody}]`);
        }
        const lenStr = pad(ACK_BODY_LENGTH, 4);
        const crc = siaCRC(ackBody);
        return `\r\n${lenStr}${ackBody}${crc}\r\n`;
    }

    function buildInquiryPacket(account, seq) {
        const acct = (account || "").toString().replace(/[^0-9A-Za-z]/g,"");
        const seqStr = (seq || 1).toString().padStart(4, '0');
        return `I${acct},${seqStr},00\r\n`;
    }

    function GalaxySIAInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const cfg = RED.nodes.getNode(config.config);
        if (!cfg || !cfg.panelPort || !cfg.account) {
            node.error("Invalid configuration: missing panelPort/account");
            node.status({ fill: 'red', shape: 'ring', text: 'bad config' });
            return;
        }

        let server = null;
        let sockets = [];

        function setStatus(text, color='green', shape='dot') {
            node.status({ fill: color, shape: shape, text: text });
        }

        function startPolling(socket, account) {
            if (socket._pollInterval) clearInterval(socket._pollInterval);
            let seq = 1;
            const interval = Number(cfg.pollingInterval) || POLLING_INTERVAL_DEFAULT;
            socket._pollInterval = setInterval(() => {
                if (socket.writable) {
                    const inq = buildInquiryPacket(account, seq);
                    socket.write(inq);
                    node.debug(`Sent inquiry: ${inq.trim()}`);
                    seq = (seq % POLLING_SEQ_MAX) + 1;
                }
            }, interval * 1000);
        }
        function stopPolling(socket) {
            if (socket && socket._pollInterval) clearInterval(socket._pollInterval);
        }

        function handleSocket(socket) {
            if (sockets.length >= MAX_CONNECTIONS) { socket.destroy(); return; }
            sockets.push(socket);
            setStatus('connected');

            socket.on('data', data => {
                // Rozdělíme na zprávy podle CRLF
                data.toString('ascii').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).forEach(line => {
                    // Handshake
                    if (/^[FD]#?\w+/.test(line)) {
                        // Extrahujeme účet z handshake
                        let account = (line.split("#")[1]||"").replace(/[^0-9A-Za-z]/g,"").trim();
                        if (!account) account = cfg.account;
                        const ackStr = buildAckPacket(account, "00");
                        socket.write(ackStr);
                        node.send({ payload: { type: 'handshake', raw: line, ack: ackStr, account, ts: new Date().toISOString() } });
                        startPolling(socket, account);
                        return;
                    }
                    // Ostatní SIA zprávy
                    let parsed;
                    try { parsed = parseSIA(line); } catch (e) { node.warn(`Parse error: ${e.message}`); return; }
                    if (parsed && parsed.valid) {
                        const ackStr = buildAckPacket(parsed.account, parsed.seq || "00");
                        socket.write(ackStr);
                        node.send({ payload: { ...parsed, raw: line, ack: ackStr, ts: new Date().toISOString() } });
                    } else if (line) {
                        node.warn(`Invalid SIA packet: ${line}`);
                    }
                });
            });
            socket.on('close',()=>{ stopPolling(socket); setStatus('disconnected','yellow','ring'); sockets = sockets.filter(s=>s!==socket); });
            socket.on('error',e=>{ stopPolling(socket); node.error(`sock err ${e.message}`); setStatus('sock error','red'); });
        }

        server = net.createServer(handleSocket);
        server.maxConnections = MAX_CONNECTIONS;
        server.listen(cfg.panelPort,()=>{ node.log(`Listening ${cfg.panelPort}`); setStatus('listening'); });
        server.on('error',e=>{ node.error(`srv err ${e.message}`); setStatus('srv error','red'); });

        this.on('close',(removed,done)=>{ sockets.forEach(s=>s.destroy()); server&&server.close(()=>done&&done()); });
    }
    RED.nodes.registerType("galaxy-sia-in",GalaxySIAInNode);
};
