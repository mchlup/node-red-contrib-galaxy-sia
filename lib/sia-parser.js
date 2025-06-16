const crc16 = require('./crc16');

function parseSIA(message, siaLevel, encryption, key, hex) {
  const result = {
    valid: false,
    error: null,
    crcOk: false,
    func: null,
    account: null,
    seq: null,
    event: null,
    zone: null,
    user: null,
    area: null,
    timestamp: null,
    raw: null,
  };

  try {
    if (!message || message.length < 8) {
      result.error = "Empty or too short message";
      return result;
    }
    let msg = String(message).trim();

    result.raw = msg;

    // Remove "SIA-DCS" header if present
    if (msg.startsWith("SIA-DCS")) {
      msg = msg.substring(7).trim();
    }

    // Parse SIA header: 4 digits length, space, 4 hex CRC, space
    const headerMatch = msg.match(/^(\d{4}) ([0-9A-Fa-f]{4}) (.*)$/);
    if (!headerMatch) {
      result.error = "Header (length + CRC) not found";
      return result;
    }

    const msgLen = parseInt(headerMatch[1], 10);
    const msgCrc = headerMatch[2].toUpperCase();
    let body = headerMatch[3];

    // Validate length (body should be msgLen chars)
    if (body.length !== msgLen) {
      result.error = `Body length mismatch: expected ${msgLen}, got ${body.length}`;
      return result;
    }

    // CRC check (over body only)
    const calcCrc = crc16(body).toUpperCase();
    result.crcOk = (calcCrc === msgCrc);

    // Extract timestamp if present (starts with "...")
    if (body.startsWith('"')) {
      const tsMatch = body.match(/^"([^"]+)"\s+(.*)$/);
      if (tsMatch) {
        result.timestamp = tsMatch[1];
        body = tsMatch[2];
      }
    }

    // Parse main SIA fields
    // Format: func#account[seq] eventCode ... (example: Nriog1#123456[00] BA)
    const siaMatch = body.match(/^([A-Za-z0-9]+)#([0-9A-Za-z]+)\[(\d{2})\]\s+([A-Z]{2,3})/);
    if (siaMatch) {
      result.func = siaMatch[1];
      result.account = siaMatch[2];
      result.seq = siaMatch[3];
      result.event = siaMatch[4];
      result.valid = true;
    } else {
      // Fallback: just #account eventCode
      const minMatch = body.match(/^#([0-9A-Za-z]+)\s+([A-Z]{2,3})/);
      if (minMatch) {
        result.account = minMatch[1];
        result.event = minMatch[2];
        result.valid = true;
      }
    }

    // Extract zone, user, area (e.g. Z01 U02 A03)
    if (body) {
      const zoneMatch = body.match(/Z(\d+)/);
      if (zoneMatch) result.zone = zoneMatch[1];
      const userMatch = body.match(/U(\d+)/);
      if (userMatch) result.user = userMatch[1];
      const areaMatch = body.match(/A(\d+)/);
      if (areaMatch) result.area = areaMatch[1];
    }
    if (!result.valid) {
      result.error = "Unable to parse SIA body";
    }
    if (!result.crcOk) {
      result.error = "CRC error";
    }
  } catch (err) {
    result.error = "Parse error: " + err.message;
  }
  return result;
}

module.exports = {
  parseSIA
};
