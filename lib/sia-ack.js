// lib/sia-ack.js
const { siaCRC, pad } = require("./sia-parser");

function createAckMessage(account, seq = "00", rcv = "R0", lpref = "L0") {
    account = (account || "").replace(/[^0-9A-Za-z]/g,"").padStart(4, "0").slice(-4);
    const ackBody = `ACK${seq}${rcv}${lpref}#${account}`;
    if (ackBody.length !== 14) throw new Error(`ACK BODY length is NOT 14: ${ackBody.length} [${ackBody}]`);
    const lenStr = pad(14, 4);
    const crc = siaCRC(ackBody);
    return `\r\n${lenStr}${ackBody}${crc}\r\n`;
}

module.exports = { createAckMessage };
