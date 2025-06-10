// Sestavení SIA DC-09 ovládacích příkazů (ARM/DISARM/atd.) dle specifikace + plný SIA CRC algoritmus

function pad(num, len) {
    let str = String(num);
    while (str.length < len) str = '0' + str;
    return str;
}

// SIA CRC algoritmus podle oficiální dokumentace
function siaCRC(input) {
    // Polynom pro SIA CRC: x^16 + x^12 + x^5 + 1 (0x1021), seed = 0x0000
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

module.exports = function(account, command, group, encryption, key, hex) {
    // SIA-DCS <LEN> <CRC> "<timestamp>" #<account> <command>[group]|
    const date = new Date().toISOString();
    let payload = `${command}${group ? pad(group, 2) : ""}|`;
    let body = `"${date}" #${account} ${payload}`;
    let len = pad(body.length, 4);
    let crc = siaCRC(body);
    return `SIA-DCS ${len} ${crc} ${body}`;
};
