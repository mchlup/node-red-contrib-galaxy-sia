const crypto = require('crypto');
const pad = require("./sia-parser").pad;
const siaCRC = require("./sia-parser").siaCRC;

function pad(num, len) {
    let str = String(num);
    while (str.length < len) str = '0' + str;
    return str;
}

function siaCRC(input) {
    let crc = 0x0000;
    for (let i = 0; i < input.length; i++) {
        crc ^= (input.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return pad(crc.toString(16).toUpperCase(), 4);
}

function buildCommand(func, body, account) {
  // FUNC is control character or text
  const msg = `${func}${body}#${account}`;
  const len = pad(msg.length, 4);
  const crc = siaCRC(msg);
  // CRLF framing
  return `\r\n${len}${msg}${crc}\r\n`;
}

// AES-128-ECB ENCRYPTION, returns hex string
function aesEncrypt(plaintext, key, hex = false) {
    let aesKey = hex ? Buffer.from(key, 'hex') : Buffer.from(key, 'utf8');
    let cipher = crypto.createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(false); // SIA standard: NO padding!
    let padded = plaintext;
    if (plaintext.length % 16 !== 0) {
        padded = plaintext + '\0'.repeat(16 - (plaintext.length % 16));
    }
    let enc = cipher.update(padded, 'utf8', 'hex') + cipher.final('hex');
    return enc.toUpperCase();
}

module.exports = {
  arm: (account, partition = "1", code = "0000") => {
    // Partition + code: e.g., "01C1234" (C=arm)
    return buildCommand("C", `${partition}${code}`, account);
  },
  disarm: (account, partition = "1", code = "0000") => {
    // D=disarm
    return buildCommand("D", `${partition}${code}`, account);
  },
  bypass: (account, zone = "01") => {
    return buildCommand("B", zone, account);
  },
  restore: (account, zone = "01") => {
    return buildCommand("R", zone, account);
  },
  pgm: (account, output = "1", action = "01") => {
    // action: 01=on, 00=off
    return buildCommand("P", `${output}${action}`, account);
  }
};
