/**
 * Pad a number or string to fixed length with leading zeros
 */
function pad(num, len) {
  let s = String(num);
  while (s.length < len) s = "0" + s;
  return s;
}

/**
 * Compute CRC16-CCITT (poly 0x1021) over ASCII input
 * Return ALWAYS 4 uppercase hex digits (DC-09 standard)
 */
function siaCRC(input) {
  let crc = 0x0000;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000)
        ? ((crc << 1) ^ 0x1021) & 0xffff
        : (crc << 1) & 0xffff;
    }
  }
  return pad(crc.toString(16).toUpperCase(), 4);
}

/**
 * AES-128-ECB decryption (input hex, no padding)
 */
function aesDecrypt(encHex, key, hex = false) {
  const crypto = require('crypto');
  const aesKey = hex ? Buffer.from(key, "hex") : Buffer.from(key, "utf8");
  const dec = crypto.createDecipheriv("aes-128-ecb", aesKey, null);
  dec.setAutoPadding(false);
  let out = dec.update(encHex, "hex", "utf8") + dec.final("utf8");
  return out.replace(/\0+$/, "");
}

/**
 * Robustly parses a SIA DC-09 raw message.
 * Returns object with { raw, valid, crcOk, error, ...fields }
 */
function parseSIA(message, siaLevel = 4, encryption = false, key = "", hex = false) {
  const result = { raw: message, valid: false, crcOk: null, error: null };

  try {
    if (!message || typeof message !== "string" || message.length < 8) {
      result.error = "Input message too short or not a string";
      return result;
    }

    message = message.trim();

    // Strip "SIA-DCS" header if present
    const idx = message.indexOf("SIA-DCS");
    if (idx >= 0) {
      message = message.slice(idx + 7).trim();
    }

    // Length + CRC header
    const m = message.match(/^(\d{4})\s+([0-9A-F]{4})\s+/);
    if (m) {
      result.length = parseInt(m[1], 10);
      result.crc = m[2].toUpperCase();
      message = message.slice(m[0].length);

      let bodyForCrc = message;
      if (encryption && key) {
        try {
          result.decrypted = aesDecrypt(bodyForCrc, key, hex);
          message = result.decrypted;
        } catch (e) {
          result.error = "AES decryption failed: " + e.message;
          return result;
        }
      }
      result.crcCalculated = siaCRC(bodyForCrc);
      result.crcOk = result.crc === result.crcCalculated;

      if (!result.crcOk) {
        result.error = `CRC error (expected ${result.crc}, got ${result.crcCalculated})`;
      }
    } else {
      result.error = "Header (length + CRC) not found";
      return result;
    }

    // Timestamp in quotes
    const t = message.match(/^"([^"]+)"\s*/);
    if (t) {
      result.timestamp = t[1];
      message = message.slice(t[0].length);
    }

    // SIA event code, account, sequence
    // Example: Nriog1#123456[00] BA
    const c = message.match(/^([A-Za-z0-9]+)#([A-Za-z0-9]+)\[(\d{2})\]\s+([A-Z]{2,3})/);
    if (c) {
      result.func = c[1];
      result.account = c[2];
      result.seq = c[3];
      result.event = c[4];
      result.valid = true;
    } else {
      // fallback: try just account and event
      const c2 = message.match(/^#([A-Za-z0-9]+)\s*([A-Z]{2,3})/);
      if (c2) {
        result.account = c2[1];
        result.event = c2[2];
        result.valid = true;
      }
    }

    // Parse zone/user/area if present, e.g. ... Z01 U01 A01
    const fields = message.match(/Z(\d+)|U(\d+)|A(\d+)/g);
    if (fields) {
      fields.forEach(f => {
        if (f.startsWith("Z")) result.zone = f.substring(1);
        else if (f.startsWith("U")) result.user = f.substring(1);
        else if (f.startsWith("A")) result.area = f.substring(1);
      });
    }
  } catch (err) {
    result.error = "Parse error: " + err.message;
  }

  return result;
}

module.exports = {
  pad,
  siaCRC,
  parseSIA,
  aesDecrypt
};
