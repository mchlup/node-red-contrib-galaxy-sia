const crypto = require('crypto');

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

module.exports = function(account, command, group, encryption, key, hex) {
    // SIA-DCS <LEN> <CRC> "<timestamp>" #<account> <command>[group]|
    const date = new Date().toISOString();
    let payload = `${command}${group ? pad(group, 2) : ""}|`;
    let body = `"${date}" #${account} ${payload}`;

    if (encryption && key) {
        body = aesEncrypt(body, key, hex);
    }

    let len = pad(body.length, 4);
    let crc = siaCRC(body);
    return `SIA-DCS ${len} ${crc} ${body}`;
};
