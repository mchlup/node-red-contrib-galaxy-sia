// lib/sia-parser.js
const crypto = require('crypto');

function siaCRC(str) {
    // SIA CRC16 CCITT
    let crc = 0x0000;
    for (let i = 0; i < str.length; ++i) {
        crc ^= (str.charCodeAt(i) << 8);
        for (let j = 0; j < 8; ++j)
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}

function pad(str, len) {
    return str.toString().padStart(len, '0');
}

function parseSIA(message) {
    // Čistý text bez whitespace
    message = (message||"").toString().trim();
    if (!message) return { valid:false, error:"Empty" };
    // SIA DC-09 zprávy mají hlavičku délky, tělo a CRC, např. "0036ACK00R0L0#1234A2B9"
    let m = message.match(/^(\d{4})([A-Z]{3}\d{2}[A-Z]\d{2}[A-Z]#([0-9A-Za-z]{3,8}))/);
    if (m) {
        let len = parseInt(m[1]);
        let body = m[2];
        let account = m[3];
        let crc = message.substr(8 + len, 4);
        let calcCRC = siaCRC(body);
        return {
            valid: true,
            type: "ack",
            account: account,
            body: body,
            crc: crc,
            crcOk: crc === calcCRC
        };
    }
    // SIA event – např. 'SIA-DCS' zpráva...
    let event = message.match(/#([0-9A-Za-z]+)\[(\d{2})\]\s+([A-Z]{2,3})/);
    if (event) {
        return {
            valid: true,
            type: "event",
            account: event[1],
            seq: event[2],
            eventType: event[3],
            body: message
        };
    }
    // Fallback: neplatné
    return { valid: false, error: "Unrecognized message" };
}

module.exports = {
    siaCRC,
    pad,
    parseSIA
};
