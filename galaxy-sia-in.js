/**
 * Node-RED node for Honeywell Galaxy SIA DC-09 integration.
 * (C) 2021-2025 Michal Lupinek, Martin Chlup
 * Opravy: handshake, inquiry polling, správné ACK, validace, konfigurace.
 */

const net = require('net');
const { createAckMessage } = require('./lib/sia-ack');
const { parseSIA } = require('./lib/sia-parser');

const HEARTBEAT_INTERVAL_DEFAULT = 60;
const HEARTBEAT_PAYLOAD = "HEARTBEAT";
const MAX_CONNECTIONS = 20;

module.exports = function(RED) {
    function GalaxySiaInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Ošetři a validuj účet
        config.account = (config.account || "").trim().toUpperCase();

        const port = Number(config.port) || 10000;
        const heartbeatInterval = Number(config.heartbeatInterval) || HEARTBEAT_INTERVAL_DEFAULT;
        const pollingType = config.pollingType || "inquiry";
        const debug = !!config.debug;

        let server, heartbeatTimer = null, sockets = [];

        function sendInquiry(socket, account, seq = "00") {
            const acc = (account || config.account || "").trim().toUpperCase();
            if (!acc) return;
            const message = `I${acc},${seq},00\r\n`;
            socket.write(message);
            node.status({fill:"blue",shape:"dot",text:`inquiry sent (${acc})`});
            if (debug) node.log(`Inquiry sent: ${message.replace('\r\n','')}`);
        }

        function sendHeartbeat(socket) {
            socket.write(HEARTBEAT_PAYLOAD);
            node.status({fill:"blue",shape:"dot",text:"heartbeat sent"});
            if (debug) node.log("HEARTBEAT sent.");
        }

        function startPolling() {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => {
                sockets.forEach((socketObj) => {
                    if (socketObj.socket && !socketObj.socket.destroyed) {
                        if (pollingType === "inquiry") {
                            sendInquiry(socketObj.socket, socketObj.account, "00");
                        } else {
                            sendHeartbeat(socketObj.socket);
                        }
                    }
                });
            }, heartbeatInterval * 1000);
        }

        function stopPolling() {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }

        // TCP server
        server = net.createServer((socket) => {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 60000);

            const socketObj = { socket, account: null };
            sockets.push(socketObj);

            node.status({fill:"yellow",shape:"dot",text:"připojeno"});

            socket.on('data', (data) => {
                let rawStr = data.toString().trim();

                if (debug) node.log(`Přijato: ${rawStr}`);

                // Handshake detekce (F#... nebo D#...)
                const handshakeMatch = /^([FD]#?[0-9A-Za-z]+)/.exec(rawStr);
                if (handshakeMatch) {
                    let account = "";
                    const accMatch = /#([0-9A-Za-z]+)/.exec(rawStr);
                    if (accMatch) account = accMatch[1].trim().toUpperCase();

                    socketObj.account = account;
                    let ackBuffer;
                    try {
                        ackBuffer = createAckMessage(rawStr);
                        socket.write(ackBuffer);
                        if (debug) node.log(`ACK sent: ${ackBuffer.toString('ascii').replace(/\r?\n/g,'')}`);
                    } catch (err) {
                        node.warn(`ACK generování selhalo: ${err}`);
                        node.status({fill:"red",shape:"ring",text:"ACK error"});
                        return;
                    }
                    node.send([
                        { payload: { type: "handshake", raw: rawStr, account, ack: ackBuffer }, topic: "handshake" },
                        null
                    ]);
                    node.status({fill:"green",shape:"dot",text:"handshake"});

                    // Po handshake ihned inquiry pokud nastaveno
                    if (pollingType === "inquiry") {
                        sendInquiry(socket, account, "00");
                    }
                    return;
                }

                // Není handshake – parsuj jako SIA
                const parsed = parseSIA(rawStr, config.siaLevel, config.encryption, config.key, config.hex);
                if (parsed && parsed.valid) {
                    try {
                        const ackBuffer = createAckMessage(rawStr);
                        socket.write(ackBuffer);
                        if (debug) node.log(`ACK sent: ${ackBuffer.toString('ascii').replace(/\r?\n/g,'')}`);
                        node.send([
                            { payload: { type: "sia_message", raw: rawStr, parsed, ack: ackBuffer, timestamp: Date.now() }, topic: "sia" },
                            parsed
                        ]);
                        node.status({fill:"green",shape:"dot",text:`SIA: ${parsed.event || ""}`});
                    } catch (err) {
                        node.warn(`ACK selhalo: ${err}`);
                        node.status({fill:"red",shape:"ring",text:"ACK error"});
                    }
                } else {
                    node.warn(`Neplatná/nerozpoznaná zpráva: ${rawStr}`);
                    node.status({fill:"yellow",shape:"ring",text:"invalid message"});
                }
            });

            socket.on('end', () => {
                sockets = sockets.filter((s) => s.socket !== socket);
                node.status({fill:"grey",shape:"ring",text:"odpojeno"});
            });

            socket.on('error', (err) => {
                node.warn(`Chyba socketu: ${err}`);
                sockets = sockets.filter((s) => s.socket !== socket);
            });
        });

        server.maxConnections = MAX_CONNECTIONS;
        server.listen(port, () => {
            node.status({fill:"green",shape:"dot",text:`listening on ${port}`});
        });

        startPolling();

        node.on('close', (done) => {
            stopPolling();
            sockets.forEach((s) => {
                if (s.socket && !s.socket.destroyed) s.socket.destroy();
            });
            sockets = [];
            if (server) server.close(done);
            else done();
        });
    }

    RED.nodes.registerType("galaxy-sia-in", GalaxySiaInNode);
};
