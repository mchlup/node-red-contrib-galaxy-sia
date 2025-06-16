/**
 * SIA DC-09 ACK generator
 * Úprava: vždy doplň účet na 4 znaky zleva nulami, trim vstupy, robustní extrakce.
 */

const crc16ccitt = require('./crc16ccitt');

const ACK_LENGTH = 26; // 2(CRLF) + 4(len) + 14(body) + 4(CRC) + 2(CRLF)

function createAckMessage(message) {
    let raw = (message || "").trim();

    let seq = "00", rcv = "R0", line = "L0", account = "0000";

    let accMatch = /#([0-9A-Za-z]+)/.exec(raw);
    if (accMatch) account = accMatch[1].trim().toUpperCase();

    account = account.padStart(4, "0");

    const seqMatch = /\[(\d{2})\]/.exec(raw);
    if (seqMatch) seq = seqMatch[1];

    const rcvMatch = /(R\d)/i.exec(raw);
    if (rcvMatch) rcv = rcvMatch[1].toUpperCase();
    const lineMatch = /(L\d)/i.exec(raw);
    if (lineMatch) line = lineMatch[1].toUpperCase();

    const ackBody = `ACK${seq}${rcv}${line}#${account}`; // délka musí být 14 znaků vždy

    const lenStr = ackBody.length.toString().padStart(4, "0");
    const crcStr = crc16ccitt(ackBody).toString(16).toUpperCase().padStart(4, "0");

    const packet = `\r\n${lenStr}${ackBody}${crcStr}\r\n`;

    if (Buffer.byteLength(packet) !== ACK_LENGTH) {
        throw new Error(`Invalid ACK length: ${Buffer.byteLength(packet)}, expected ${ACK_LENGTH}`);
    }

    return Buffer.from(packet, 'ascii');
}

module.exports = { createAckMessage };
