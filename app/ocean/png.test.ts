import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { crc32, encodePng } from './png.ts';

/** The IHDR size and the unfiltered pixel rows of a PNG `encodePng` wrote. */
function decode(png: Buffer): { width: number; height: number; rows: number[][] } {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const stride = width * 3 + 1;
    const rows = Array.from({ length: height }, (_, y) => [
        ...raw.subarray(y * stride, (y + 1) * stride),
    ]);
    return { width, height, rows };
}

describe('crc32', () => {
    // Reference values of CRC-32/ISO-HDLC, the variant PNG and zlib use.
    it.each([
        ['', 0],
        ['123456789', 0xcbf43926],
        ['The quick brown fox jumps over the lazy dog', 0x414fa339],
    ])('matches the reference for %j', (input, expected) => {
        expect(crc32(Buffer.from(input, 'latin1'))).toBe(expected);
    });
});

describe('encodePng', () => {
    it('starts with the PNG signature and an RGB header', () => {
        const png = encodePng(2, 1, new Uint8Array(6));
        expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
        expect(png[24]).toBe(8);
        expect(png[25]).toBe(2);
    });

    it('upscales each pixel into a square block', () => {
        const rgb = new Uint8Array([255, 0, 0, 0, 0, 255]);
        const { width, height, rows } = decode(encodePng(2, 1, rgb, 2));
        expect([width, height]).toEqual([4, 2]);
        const red = [255, 0, 0];
        const blue = [0, 0, 255];
        for (const row of rows) expect(row).toEqual([0, ...red, ...red, ...blue, ...blue]);
    });
});
