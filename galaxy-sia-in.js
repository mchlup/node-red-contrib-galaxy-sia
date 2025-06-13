// galaxy-sia-node-red-node.js
// Node-RED custom node: Galaxy SIA DC-09 connector for Honeywell Galaxy Dimension
// - Správné odesílání ACK (14 bytů, CRC)
// - Handshake, Inquiry polling, ACK eventů
// - Konfigurace portu, account, polling interval

module.exports = function(RED) {
    const net = require('net');
    const parseSIA = require('./lib/sia-parser');
    const siaCRC = parseSIA.siaCRC;
    const pad = parseSIA.pad;

    function GalaxySiaNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const port = parseInt(config.port) || 10002;
        const account = config.account || '';
        const pollInterval = parseInt(config.pollInterval) || 10; // seconds

        let server = null;

        // Build ACK packet: 14 byte body, 4-byte length prefix, CRC, CRLF
        function buildAck(account, seq = '00', rcv = 'R0', lp = 'L0') {
            const acct = account.toString().padStart(4, '0').slice(-4);
            const body = `ACK${seq}${rcv}${lp}#${acct}`;
            const len = pad(body.length, 4); // always '0014'
            const crc = siaCRC(body);
            return `\r\n${len}${body}${crc}\r\n`;
        }

        // Build Inquiry packet: 'I' + account + ',' + seq + ',00' + CRLF
        function buildInquiry(account, seq) {
            const acct = account.toString();
            const seqStr = seq.toString().padStart(4, '0');
            return `I${acct},${seqStr},00\r\n`;
        }

        server = net.createServer(socket => {
            node.log(`Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
            let inquirySeq = 1;
            let pollTimer = null;

            // Start polling after handshake
            function startPolling() {
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(() => {
                    const inq = buildInquiry(account, inquirySeq);
                    socket.write(inq);
                    node.debug(`Sent inquiry: ${inq.trim()}`);
                    inquirySeq = (inquirySeq % 9999) + 1;
                }, pollInterval * 1000);
            }

            socket.on('data', data => {
                const raw = data.toString('ascii');
                // Sestřih CRLF
                const lines = raw.split(/\r?\n/).filter(l => l);
                lines.forEach(line => {
                    // předpoklad formátu: [len][body][CRC]
                    let payload = { raw: line };
                    try {
                        const parsed = parseSIA(line);
                        payload = Object.assign(payload, parsed);
                    } catch(e) {
                        payload.type = 'unknown';
                    }

                    // Handshake detection: F#... nebo D#...
                    if (/^([FD]#?\d+)/.test(line)) {
                        payload.type = 'handshake';
                        node.debug(`Handshake from panel: ${line}`);
                        // send ACK
                        const ack = buildAck(account);
                        socket.write(ack);
                        node.debug(`Sent handshake ACK: ${ack.trim()}`);
                        // start polling inquiries
                        startPolling();
                    } else if (payload.type === 'event' || payload.type === 'status' || payload.type === 'null') {
                        // send ACK to event/status/null
                        const ack = buildAck(account, payload.seq || '00');
                        socket.write(ack);
                        node.debug(`Sent event ACK: ${ack.trim()}`);
                    }

                    // emit message
                    node.send({ payload });
                });
            });

            socket.on('close', () => {
                node.log('Client disconnected');
                if (pollTimer) clearInterval(pollTimer);
            });

            socket.on('error', err => {
                node.error(`Socket error: ${err.message}`);
            });
        }).listen(port, () => {
            node.log(`Galaxy SIA DC-09 listening on port ${port}`);
        });

        node.on('close', done => {
            if (server) {
                node.log('Closing SIA server');
                server.close(done);
            } else done();
        });
    }

    RED.nodes.registerType('galaxy-sia-in', GalaxySiaNode, {
        defaults: {
            name: { value: '' },
            port: { value: 10002, required: true },
            account: { value: '', required: true },
            pollInterval: { value: 10 }
        }
    });
};
