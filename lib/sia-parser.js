// Robustní parser SIA DC-09 zpráv pro Node-RED
// Umí detekovat typické SIA hlavičky, zprávu, účet, kód události, popis a další pole.

function hexToAscii(hex) {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

function parseSIA(message) {
    // SIA zpráva typicky vypadá takto (příklad, reálně může být delší/více variant):
    // "\n\rSIA-DCS" + len + " " + CRC + " " + [timestamp] + "#account[|sequence] [code]" + ... <CR><LF>
    // Příklad: "\n\rSIA-DCS 0041 01CB \"2023-06-10T12:34:56\" #000001 [Nri1234] BA0001  |Some text\n\r"
    // Může být i ve variantě: "#000001 [BA] [zone] ..."

    const result = {
        raw: message,
        valid: false
    };

    // Odstraníme případné CRLF na začátku/konce
    message = message.replace(/^\s+|\s+$/g, '');

    // Najdeme začátek zprávy (volitelně SIA-DCS)
    let siaIdx = message.indexOf('SIA-DCS');
    if (siaIdx >= 0) {
        message = message.substr(siaIdx + 7).trim();
    }

    // Očekáváme [dloužka] [CRC] [volitelný timestamp] #účet [data]
    // Např.: "0041 01CB \"2023-06-10T12:34:56\" #000001 BA0001  |Some text"
    //        "0041 01CB #000001 BA0001  |Some text"

    // Délka a CRC (ne vždy přítomné)
    let lengthMatch = message.match(/^(\d{4}) ([0-9A-Fa-f]{4}) /);
    if (lengthMatch) {
        result.length = parseInt(lengthMatch[1]);
        result.crc = lengthMatch[2];
        message = message.slice(lengthMatch[0].length);
    }

    // Timestamp
    let tsMatch = message.match(/^\"([^\"]+)\"\s*/);
    if (tsMatch) {
        result.timestamp = tsMatch[1];
        message = message.slice(tsMatch[0].length);
    }

    // Účet (account), začíná #
    let accMatch = message.match(/^#([0-9A-Za-z]+)\s*/);
    if (accMatch) {
        result.account = accMatch[1];
        message = message.slice(accMatch[0].length);
    }

    // Nyní očekáváme hlavní payload: kód události, volitelně [modifikátory] a popis
    // Obecný tvar: "[code][zone][modifier][user][ |text]"
    // Např.: "BA0001  |Some text"
    let payload = message.trim();
    let codeMatch = payload.match(/^([A-Z0-9]{2,3})(\d{0,4})\s*\|?(.*)$/);
    if (codeMatch) {
        result.code = codeMatch[1];
        result.zone = codeMatch[2] ? parseInt(codeMatch[2]) : undefined;
        result.description = codeMatch[3] ? codeMatch[3].trim() : '';
        result.valid = true;
    } else {
        // fallback: vypíšeme vše co zbylo
        result.payload = payload;
    }

    return result;
}

module.exports = parseSIA;
