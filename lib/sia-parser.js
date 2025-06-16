/**
 * SIA DC-09 parser
 * Úprava: robustnější trimování, všechny výstupy uppercase účty, zachování původní logiky CRC atd.
 */

const crc16ccitt = require('./crc16ccitt');

function parseSIA(message, siaLevel, encryption, key, hex) {
    let result = {
        valid: false,
        error: null,
        raw: message,
        crcOk: false,
        func: null,
        account: null,
        seq: null,
        event: null,
        zone: null,
        user: null,
        area: null
    };

    try {
        if (!message || message.length < 8) return result;

        let raw = message.trim();

        // Pokud je v čele "SIA-DCS", zahodit prefix
        if (raw.startsWith("SIA-DCS")) raw = raw.slice(7).trim();

        // Najdi hlavičku: 4 číslice délky + mezera + 4 hex CRC + mezera
        const headerMatch = /^(\d{4}) ([0-9A-Fa-f]{4}) /i.exec(raw);
        if (!headerMatch) {
            result.error = "Header (length + CRC) not found";
            return result;
        }

        const declaredLen = Number(headerMatch[1]);
        const receivedCrc = headerMatch[2].toUpperCase();
        let body = raw.slice(headerMatch[0].length);

        // CRC ověření
        const calculatedCrc = crc16ccitt(body).toString(16).toUpperCase().padStart(4, "0");
        result.crcOk = (calculatedCrc === receivedCrc);
        if (!result.crcOk) result.error = "CRC mismatch";

        // Timestamp v uvozovkách na začátku
        if (body[0] === '"') {
            const tsMatch = /^"([^"]+)"\s*/.exec(body);
            if (tsMatch) {
                result.timestamp = tsMatch[1];
                body = body.slice(tsMatch[0].length);
            }
        }

        // Hlavní části: func#account[seq] event atd.
        const mainMatch = /^([A-Za-z0-9]+)#([A-Za-z0-9]+)\[(\d{2})\]\s+([A-Z]{2,3})/.exec(body);
        if (mainMatch) {
            result.func = mainMatch[1];
            result.account = mainMatch[2].toUpperCase();
            result.seq = mainMatch[3];
            result.event = mainMatch[4];
            result.valid = true;
        } else {
            // fallback: #účet událost
            const simpleMatch = /#([A-Za-z0-9]+)\s+([A-Z]{2,3})/.exec(body);
            if (simpleMatch) {
                result.account = simpleMatch[1].toUpperCase();
                result.event = simpleMatch[2];
                result.valid = true;
            }
        }

        // Zóny, uživatelé, oblasti
        const zoneMatch = /Z(\d+)/.exec(body);
        if (zoneMatch) result.zone = zoneMatch[1];
        const userMatch = /U(\d+)/.exec(body);
        if (userMatch) result.user = userMatch[1];
        const areaMatch = /A(\d+)/.exec(body);
        if (areaMatch) result.area = areaMatch[1];

    } catch (err) {
        result.error = "Parse error: " + err;
    }

    return result;
}

module.exports = { parseSIA };
