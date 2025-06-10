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

function parseSIA(message) {
    const result = {
        raw: message,
        valid: false,
        crcOk: null
    };

    message = message.replace(/^\s+|\s+$/g, '');

    let siaIdx = message.indexOf('SIA-DCS');
    if (siaIdx >= 0) {
        message = message.substr(siaIdx + 7).trim();
    }

    let lengthMatch = message.match(/^(\d{4}) ([0-9A-Fa-f]{4}) /);
    if (lengthMatch) {
        result.length = parseInt(lengthMatch[1]);
        result.crc = lengthMatch[2].toUpperCase();
        message = message.slice(lengthMatch[0].length);

        // Najít tělo pro CRC check
        let crcBody = message;
        let quoteIdx = message.indexOf('"');
        if (quoteIdx > 0) {
            // pro CRC kontrolu se tělo hledá zpět od # před #account
            let bodyStart = message.indexOf('"');
            let body = message.substring(bodyStart, message.length);
            // Ověřit CRC
            result.crcCalculated = siaCRC(body);
            result.crcOk = (result.crc === result.crcCalculated);
        }
    }

    let tsMatch = message.match(/^\"([^\"]+)\"\s*/);
    if (tsMatch) {
        result.timestamp = tsMatch[1];
        message = message.slice(tsMatch[0].length);
    }

    let accMatch = message.match(/^#([0-9A-Za-z]+)\s*/);
    if (accMatch) {
        result.account = accMatch[1];
        message = message.slice(accMatch[0].length);
    }

    let payload = message.trim();
    let codeMatch = payload.match(/^([A-Z0-9]{2,3})(\d{0,4})\s*\|?(.*)$/);
    if (codeMatch) {
        result.code = codeMatch[1];
        result.zone = codeMatch[2] ? parseInt(codeMatch[2]) : undefined;
        result.description = codeMatch[3] ? codeMatch[3].trim() : '';
        result.valid = true;
    } else {
        result.payload = payload;
    }

    return result;
}

module.exports = parseSIA;
