const crypto = require("crypto");

/** Pad a number or string to fixed length with leading zeros */
function pad(num, len) {
  let s = String(num);
  while (s.length < len) s = "0" + s;
  return s;
}

/** Compute CRC16-CCITT (poly 0x1021) over ASCII input */
function siaCRC(input) {
  let crc = 0x0000;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000)
        ? ((crc << 1) ^ 0x1021) & 0xFFFF
        : (crc << 1) & 0xFFFF;
    }
  }
  return pad(crc.toString(16).toUpperCase(), 4);
}

/** AES-128-ECB decryption (input hex, no padding) */
function aesDecrypt(encHex, key, hex = false) {
  const aesKey = hex ? Buffer.from(key, "hex") : Buffer.from(key, "utf8");
  const dec    = crypto.createDecipheriv("aes-128-ecb", aesKey, null);
  dec.setAutoPadding(false);
  let out = dec.update(encHex, "hex", "utf8") + dec.final("utf8");
  return out.replace(/\0+$/, "");
}

/**
 * Parse an SIA DC-09 raw message.
 * Returns object with { raw, valid, crcOk, length, timestamp, account, seq, code, zone, description, decrypted }
 */
function parseSIA(message, siaLevel = 4, encryption = false, key = "", hex = false) {
  const result = { raw: message, valid: false, crcOk: null };
  message = message.trim();

  // Strip "SIA-DCS" header if present
  const idx = message.indexOf("SIA-DCS");
  if (idx >= 0) {
    message = message.slice(idx + 7).trim();
  }

  // Length + CRC header
  const m = message.match(/^(\d{4})\s+([0-9A-F]+)\s+/);
  if (m) {
    result.length = parseInt(m[1],10);
    result.crc    = m[2].toUpperCase();
    message       = message.slice(m[0].length);

    let bodyForCrc = message;
    if (encryption && key) {
      result.decrypted = aesDecrypt(bodyForCrc, key, hex);
      message = result.decrypted;
    }
    result.crcCalculated = siaCRC(bodyForCrc);
    result.crcOk = result.crc === result.crcCalculated;
  }

  // Timestamp in quotes
  const t = message.match(/^"([^"]+)"\s*/);
  if (t) {
    result.timestamp = t[1];
    message = message.slice(t[0].length);
  }

  // Account#sequence
  const a = message.match(/^#([0-9A-Za-z]+)(?:\[(\d{2})\])?\s*/);
  if (a) {
    result.account = a[1];
    result.seq     = a[2] || "00";
    message = message.slice(a[0].length);
  }

  // Code, zone and description
  const p = message.match(/^([A-Z0-9]{2,3})(\d*)(?:\s*\|\s*(.*))?$/);
  if (p) {
    result.code        = p[1];
    result.zone        = p[2] ? parseInt(p[2],10) : undefined;
    result.description = p[3] || "";
    result.valid       = true;
  } else {
    result.payload = message;
  }

  return result;
}

module.exports = parseSIA;
module.exports.pad = pad;
module.exports.siaCRC = siaCRC;
module.exports.aesDecrypt = aesDecrypt;
