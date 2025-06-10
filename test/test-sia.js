const parseSIA = require('../lib/sia-parser');
const siaCmd = require('../lib/sia-command');

const ACCOUNT = '000123';
const CMD = 'AR';
const GROUP = 1;
const KEY = '1234567890ABCDEF'; // 16 znaků (128 bitů)

// --- TEST bez šifrování ---
let siaMsg = siaCmd(ACCOUNT, CMD, GROUP, false, '', false);
console.log('Test zpráva bez šifrování:', siaMsg);
console.log('Parser výsledek:', parseSIA(siaMsg));

// --- TEST s šifrováním ---
let siaMsgEnc = siaCmd(ACCOUNT, CMD, GROUP, true, KEY, false);
console.log('Test zpráva s AES:', siaMsgEnc);
console.log('Parser výsledek:', parseSIA(siaMsgEnc, 4, true, KEY, false));
