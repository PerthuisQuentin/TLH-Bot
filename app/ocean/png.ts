import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COLOR_TYPE_RGB = 2;

// Own CRC-32 rather than `zlib.crc32`, which only exists from Node 20.15: production runs 18.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

/** The CRC-32 PNG chunks carry (ISO 3309, the one zlib computes). */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/**
 * An 8-bit RGB PNG of `rgb` (row-major, 3 bytes a pixel), upscaled by an integer factor
 * with nearest-neighbour so pixel art stays crisp. Every row uses filter 0.
 */
export function encodePng(
    width: number,
    height: number,
    rgb: Uint8Array,
    scale = 1,
): Buffer<ArrayBuffer> {
    const w = width * scale;
    const h = height * scale;
    const stride = w * 3 + 1;
    const raw = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const srcRow = Math.floor(y / scale) * width;
        for (let x = 0; x < w; x++) {
            const src = (srcRow + Math.floor(x / scale)) * 3;
            raw.set(rgb.subarray(src, src + 3), y * stride + 1 + x * 3);
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8;
    header[9] = COLOR_TYPE_RGB;

    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
