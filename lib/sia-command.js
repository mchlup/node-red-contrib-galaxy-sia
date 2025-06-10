// Sestavení SIA DC-09 ovládacích příkazů (ARM/DISARM/atd.) dle specifikace

function pad(num, len) {
    let str = String(num);
    while (str.length < len) str = '0' + str;
    return str;
}

// Jednoduchý CRC placeholder (není reálný SIA CRC algoritmus!)
// Pro testovací provoz dostačující, do produkce doplňte plnohodnotný algoritmus!
function fakeCRC(str) {
    let sum = 0;
    for (let i = 0; i < str.length; i++) sum += str.charCodeAt(i);
    return pad((sum % 65536).toString(16).toUpperCase(), 4);
}

module.exports = function(account, command, group, encryption, key, hex) {
    // Příklad sestavení arm/disarm příkazu
    // SIA-DCS <LEN> <CRC> "<timestamp>" #<account> <command>[group]|
    const date = new Date().toISOString();
    let payload = `${command}${group ? pad(group, 2) : ""}|`;
    let body = `"${date}" #${account} ${payload}`;
    let len = pad(body.length, 4);
    let crc = fakeCRC(body);
    return `SIA-DCS ${len} ${crc} ${body}`;
};
