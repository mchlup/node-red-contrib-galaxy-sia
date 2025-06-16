const crc16ccitt = require('./crc16ccitt');

const ACK_LENGTH = 26;

function createAckMessage(message) {
    let raw = (message || "").trim();

    let seq = "00", rcv = "R0", line = "L0", account = "0000";

    let accMatch = /#([0-9A-Za-z]+)/.exec(raw);
    if (accMatch) account = accMatch[1].trim().toUpperCase();

    // Oprava: vždy vezmi pouze poslední 4 znaky a doplň nulami zleva, nikdy více!
    account = account.replace(/[^0-9A-Z]/ig, ''); // odstraní nehex znaky
    account = account.length > 4 ? account.slice(-4) : account.padStart(4, "0");

    const seqMatch = /\[(\d{2})\]/.exec(raw);
    if (seqMatch) seq = seqMatch[1];

    const rcvMatch = /(R\d)/i.exec(raw);
    if (rcvMatch) rcv = rcvMatch[1].toUpperCase();
    const lineMatch = /(L\d)/i.exec(raw);
    if (lineMatch) line = lineMatch[1].toUpperCase();

    // Sestav tělo ACK – přesně 14 znaků!
    const ackBody = `ACK${seq}${rcv}${line}#${account}`;
    if (ackBody.length !== 14) {
        throw new Error(`ACK tělo má špatnou délku: ${ackBody.length}, obsah: "${ackBody}"`);
    }

    const lenStr = ackBody.length.toString().padStart(4, "0");
    const crcStr = crc16ccitt(ackBody).toString(16).toUpperCase().padStart(4, "0");

    const packet = `\r\n${lenStr}${ackBody}${crcStr}\r\n`;

    if (Buffer.byteLength(packet) !== ACK_LENGTH) {
        throw new Error(`Invalid ACK length: ${Buffer.byteLength(packet)}, expected ${ACK_LENGTH}, packet: "${packet.replace(/\r?\n/g,'\\n')}"`);
    }

    return Buffer.from(packet, 'ascii');
}

module.exports = { createAckMessage };
