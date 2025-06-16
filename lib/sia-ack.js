/**
 * Generate proper SIA DC-09 ACK message
 * Returns Buffer containing exactly formatted ACK message
 */
function generateAck(message) {
  // Extract sequence from message or use default "00"
  const seqMatch = message.match(/\[([0-9A-F]{2})\]/i);
  const seq = seqMatch ? seqMatch[1] : "00";

  // Extract receiver/line from message or use defaults
  const rcvMatch = message.match(/R([0-9A-F])/i);
  const lineMatch = message.match(/L([0-9A-F])/i);
  const receiver = rcvMatch ? `R${rcvMatch[1]}` : "R0";
  const line = lineMatch ? `L${lineMatch[1]}` : "L0";

  // Extract account and pad left with zeros to 4 characters
  const accMatch = message.match(/#([0-9A-F]+)/i);
  let account = accMatch ? accMatch[1].toUpperCase() : "0000";
  account = account.replace(/[^0-9A-F]/gi, "");
  if (account.length < 4) {
    account = account.padStart(4, "0");
  } else if (account.length > 4) {
    account = account.slice(-4);
  }

  // Construct ACK body according to SIA DC-09 spec
  const ackBody = `ACK${seq}${receiver}${line}#${account}`;
  const bodyLen = pad(ackBody.length, 4);
  const crc = siaCRC(ackBody).toUpperCase();

  // Return complete ACK with CRLF at start and end, exactly 26 bytes
  return Buffer.from(`\r\n${bodyLen}${ackBody}${crc}\r\n`, 'ascii');
}

/**
 * Pad number or string with leading zeros
 */
function pad(num, size) {
  let s = num.toString();
  while (s.length < size) s = "0" + s;
  return s;
}

/**
 * Calculate CRC16-CCITT for SIA DC-09
 * Returns uppercase hex CRC
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

module.exports = { generateAck };
