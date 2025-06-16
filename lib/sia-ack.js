/**
 * SIA DC-09 ACK generator
 * Úprava: vždy doplň účet na 4 znaky zleva nulami, trim vstupy, robustní extrakce.
 */

const crc16ccitt = require('./crc16ccitt');

const ACK_LENGTH = 26; // 2(CRLF) + 4(len) + 14(body) + 4(CRC) + 2(CRLF)

function createAckMessage(message) {
    // Ořež vstup
    let raw = (message || "").trim();

    // Extrakce sekvence, přijímače, linky, účtu
    // Standardně: "F#1000", "D#123", nebo SIA zpráva s [seq]
    let seq = "00", rcv = "R0", line = "L0", account = "0000";

    // Zkus SIA zprávu s #účet
    let accMatch = /#([0-9A-Za-z]+)/.exec(raw);
    if (accMatch) account = accMatch[1].trim().toUpperCase();

    // Doplň účet na 4 znaky zleva nulami (SIA DC-09 požaduje 4 cifry v ACK)
    account = account.padStart(4, "0");

    // Extrakce sekvence pro případ SIA zprávy [NN]
    const seqMatch = /\[(\d{2})\]/.exec(raw);
    if (seqMatch) seq = seqMatch[1];

    // Optionally extract R/L info (nepovinné, typicky R0L0)
    const rcvMatch = /(R\d)/i.exec(raw);
    if (rcvMatch) rcv = rcvMatch[1].toUpperCase();
    const lineMatch = /(L\d)/i.exec(raw);
    if (lineMatch) line = lineMatch[1].toUpperCase();

    // Sestav tělo ACK
    const ackBody = `ACK${seq}${rcv}${line}#${account}`; // délka musí být 14 znaků vždy

    // Délka těla (14), 4 znaky ASCII čísel (např. "0014")
    const lenStr = ackBody.length.toString().padStart(4, "0");
    // CRC přes tělo
    const crcStr = crc16ccitt(ackBody).toString(16).toUpperCase().padStart(4, "0");

    // Kompletní zpráva: CRLF, délka, tělo, CRC, CRLF
    const packet = `\r\n${lenStr}${ackBody}${crcStr}\r\n`;

    // Kontrola délky
    if (Buffer.byteLength(packet) !== ACK_LENGTH) {
        throw new Error(`Invalid ACK length: ${Buffer.byteLength(packet)}, expected ${ACK_LENGTH}`);
    }

    return Buffer.from(packet, 'ascii');
}

module.exports = { createAckMessage };
