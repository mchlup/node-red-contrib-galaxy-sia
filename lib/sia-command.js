const crypto = require('crypto');
const { pad, siaCRC } = require("./sia-parser");

function buildCommand(func, body, account) {
    const msg = `${func}${body}#${account}`;
    const len = pad(msg.length, 4);
    const crc = siaCRC(msg);
    return `\r\n${len}${msg}${crc}\r\n`;
}

function aesEncrypt(plaintext, key, hex = false) {
    let aesKey = hex ? Buffer.from(key, 'hex') : Buffer.from(key, 'utf8');
    let cipher = crypto.createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(false);
    let padded = plaintext;
    if (plaintext.length % 16 !== 0) {
        padded = plaintext + '\0'.repeat(16 - (plaintext.length % 16));
    }
    let enc = cipher.update(padded, 'utf8', 'hex') + cipher.final('hex');
    return enc.toUpperCase();
}

module.exports = {
    arm: (account, partition = "1", code = "0000") =>
        buildCommand("C", `${partition}${code}`, account),
    disarm: (account, partition = "1", code = "0000") =>
        buildCommand("D", `${partition}${code}`, account),
    bypass: (account, zone = "01") =>
        buildCommand("B", zone, account),
    restore: (account, zone = "01") =>
        buildCommand("R", zone, account),
    pgm: (account, output = "1", action = "01") =>
        buildCommand("P", `${output}${action}`, account)
};
