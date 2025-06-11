/**
 * galaxy-sia-in.js
 *
 * Galaxy SIA In Node
 * Přijímá surová SIA data z konfiguračního uzlu, parsuje je
 * a odpovídá SIA-DC09 kompatibilním ACK paketem.
 */
module.exports = function(RED) {
  const parseSia = require('../lib/sia-parser');
  const siaCRC   = parseSia.siaCRC;
  const pad      = parseSia.pad;

  function GalaxySiaInNode(config) {
    RED.nodes.createNode(this, config);
    const cfgNode = RED.nodes.getNode(config.config);
    const node    = this;
    let buffer    = '';

    // Přijímáme data z config-uzlu
    cfgNode.on('data', chunk => {
      buffer += chunk.toString('ascii');
      let idx;
      while ((idx = buffer.indexOf('\r')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleMessage(raw);
      }
    });

    function handleMessage(rawStr) {
      // Handshake (D#... / F#...)
      const hs = rawStr.match(/^([FD]#?[0-9A-Za-z]+).*$/);
      if (hs) {
        // prosté echo handshake
        cfgNode.socket.write(hs[1], 'ascii');
        return;
      }

      // Parsování SIA zprávy
      const parsed = parseSia.parse(rawStr);
      if (!parsed) return;

      // Ignorujeme zprávy pro jiné účty
      if (parsed.account !== cfgNode.account) return;

      if (parsed.valid) {
        // SIA-DC09 ACK
        const seq      = parsed.seq   || '00';
        const rcv      = parsed.rcv   || 'R0';
        const lpref    = parsed.lpref || 'L0';
        const funcChar = '\x06';  // control-znak ACK
        const body     = `${seq}${rcv}${lpref}#${cfgNode.account}`;
        const len      = pad((funcChar + body).length, 4);
        const crc      = siaCRC(funcChar + body);
        const ackPkt   = `\r\n${len}${funcChar}${body}${crc}\r\n`;
        cfgNode.socket.write(ackPkt, 'ascii');
        node.send({ payload: { ...parsed, ack: ackPkt, raw: rawStr } });
      } else {
        node.warn(`Invalid CRC for message: ${rawStr}`);
      }
    }

    this.on('close', done => {
      // nic dalšího není třeba čistit
      done();
    });
  }

  RED.nodes.registerType('galaxy-sia-in', GalaxySiaInNode);
};
