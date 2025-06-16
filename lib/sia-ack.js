const crc16 = require('./crc16');

// Length of ACK packet: 2xCRLF + 4 (len) + 14 (body) + 4 (crc) + 2xCRLF = 26 bytes
const ACK_LENGTH = 26;

function leftPad(str, len, ch) {
  str = String(str);
  while (str.length < len) str = ch + str;
  return str;
}

function extractAccount(rawStr) {
  // Extract account after '#', ignore invisible chars, uppercase, hex only
  const idx = rawStr.indexOf('#');
  if (idx === -1) return '';
  return rawStr.substring(idx + 1).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}

function createAckMessage(message) {
  // Always trim before processing
  const msg = String(message).trim();

  // Extract seq, Rcv, Line
  let seq = '00', rcv = 'R0', line = 'L0';
  let account = extractAccount(msg);

  // Ensure account is 4 chars, left pad with zeros
  account = leftPad(account, 4, '0');

  // Optionally extract seq etc. from message (for regular SIA msg)
  const siaMatch = msg.match(/^([A-Za-z0-9]+)#([0-9A-Za-z]+)\[(\d{2})\]\s+/);
  if (siaMatch) {
    seq = siaMatch[3];
    // rcv/line not always present, use defaults
  }

  const ackBody = `ACK${seq}${rcv}${line}#${account}`; // always 14 chars

  if (ackBody.length !== 14) {
    throw new Error(`ACK body wrong length: ${ackBody.length}`);
  }

  const lenStr = leftPad(String(ackBody.length), 4, '0');
  const crcStr = crc16(ackBody).toUpperCase();

  // Full packet: CRLF + len + ackBody + crc + CRLF
  const packet = `\r\n${lenStr}${ackBody}${crcStr}\r\n`;
  const buf = Buffer.from(packet, 'ascii');
  return buf;
}

function validateAckLength(buf) {
  return buf && buf.length === ACK_LENGTH;
}

module.exports = {
  createAckMessage,
  validateAckLength
};
