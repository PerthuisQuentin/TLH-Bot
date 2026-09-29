import { encodePng } from './png.ts';

type Rgb = readonly [number, number, number];

/** A sprite is rows of palette keys; a key missing from the palette is transparent. */
export type Palette = Readonly<Record<string, string>>;

const rgbCache = new Map<string, Rgb>();

function parseHex(color: string): Rgb {
    let rgb = rgbCache.get(color);
    if (!rgb) {
        rgb = [
            parseInt(color.slice(1, 3), 16),
            parseInt(color.slice(3, 5), 16),
            parseInt(color.slice(5, 7), 16),
        ];
        rgbCache.set(color, rgb);
    }
    return rgb;
}

/**
 * A deterministic generator seeded by a string (FNV-1a into mulberry32). Each element of the
 * scene takes its own name as the seed, so adding one never shifts another's draws.
 */
export function seededRandom(seed: string): () => number {
    let h = 2166136261;
    for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h += 0x6d2b79f5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** An RGB pixel buffer. Coordinates are rounded, and anything off the canvas is dropped. */
export class PixelCanvas {
    private readonly px: Uint8Array;

    constructor(
        readonly width: number,
        readonly height: number,
        fill?: string,
    ) {
        this.px = new Uint8Array(width * height * 3);
        if (fill) {
            const rgb = parseHex(fill);
            for (let i = 0; i < width * height; i++) this.px.set(rgb, i * 3);
        }
    }

    set(x: number, y: number, color: string): void {
        const i = this.index(x, y);
        if (i >= 0) this.px.set(parseHex(color), i);
    }

    /** Mixes `color` over what is there, `alpha` in 0..1. */
    blend(x: number, y: number, color: string, alpha: number): void {
        const i = this.index(x, y);
        if (i < 0) return;
        const rgb = parseHex(color);
        for (let k = 0; k < 3; k++) {
            this.px[i + k] = Math.round(this.px[i + k] * (1 - alpha) + rgb[k] * alpha);
        }
    }

    sprite(x: number, y: number, rows: readonly string[], palette: Palette, flip = false): void {
        rows.forEach((row, j) => {
            for (let i = 0; i < row.length; i++) {
                const color = palette[row[i]];
                if (color) this.set(x + (flip ? row.length - 1 - i : i), y + j, color);
            }
        });
    }

    /** Copies `src` in, upscaled by an integer factor. */
    paste(src: PixelCanvas, ox: number, oy: number, scale = 1): void {
        for (let y = 0; y < src.height * scale; y++) {
            for (let x = 0; x < src.width * scale; x++) {
                const from = src.index(Math.floor(x / scale), Math.floor(y / scale));
                const to = this.index(ox + x, oy + y);
                if (to >= 0) this.px.set(src.px.subarray(from, from + 3), to);
            }
        }
    }

    png(scale = 1): Buffer<ArrayBuffer> {
        return encodePng(this.width, this.height, this.px, scale);
    }

    private index(x: number, y: number): number {
        const rx = Math.round(x);
        const ry = Math.round(y);
        if (rx < 0 || ry < 0 || rx >= this.width || ry >= this.height) return -1;
        return (ry * this.width + rx) * 3;
    }
}
