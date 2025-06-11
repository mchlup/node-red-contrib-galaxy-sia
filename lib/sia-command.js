const pad    = require("./sia-parser").pad;
const siaCRC = require("./sia-parser").siaCRC;

/**
 * Build a framed SIA DC-09 command packet:
 *   CRLF + LEN(4) + FUNC + BODY + CRC + CRLF
 */
function buildCommand(func, body, account) {
  const msg = `${func}${body}#${account}`;
  const len = pad(msg.length, 4);
  const crc = siaCRC(msg);
  return `\r\n${len}${msg}${crc}\r\n`;
}

module.exports = {
  arm: (account, partition = "1", pin = "0000") =>
    buildCommand("C", `${partition}${pin}`, account),
  disarm: (account, partition = "1", pin = "0000") =>
    buildCommand("D", `${partition}${pin}`, account),
  bypass: (account, zone = "01") =>
    buildCommand("B", zone, account),
  restore: (account, zone = "01") =>
    buildCommand("R", zone, account),
  pgm: (account, output = "1", action = "01") =>
    buildCommand("P", `${output}${action}`, account)
};
