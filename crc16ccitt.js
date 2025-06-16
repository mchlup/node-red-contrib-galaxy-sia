/**
 * CRC-16-CCITT (XModem) implementation for SIA DC-09 (poly 0x1021, init 0x0000, no xor out)
 * Returns unsigned 16-bit integer. Used for SIA DC-09 CRC calculations.
 *
 * Usage: const crc = crc16ccitt("SIASTRING");
 *        const crcHex = crc.toString(16).toUpperCase().padStart(4, "0");
 */

function crc16ccitt(input) {
    let crc = 0x0000;
    let data;
    if (typeof input === "string") {
        data = Buffer.from(input, "ascii");
    } else if (Buffer.isBuffer(input)) {
        data = input;
    } else {
        throw new Error("Input must be string or Buffer");
    }

    for (let i = 0; i < data.length; i++) {
        crc ^= (data[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc & 0xFFFF;
}

module.exports = crc16ccitt;
