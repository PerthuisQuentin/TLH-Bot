/**
 * Renders the ocean scene of `/shells`, to review a sprite, a slot or a growth curve
 * without Discord.
 *
 *   tsx scripts/render-ocean.ts                       # contact sheets, one per level
 *   tsx scripts/render-ocean.ts --levels=4-2-7-5-6-1-2-1
 *   tsx scripts/render-ocean.ts --out=/some/dir
 *
 * A sheet sweeps one level from its minimum to its maximum, the others held low, left to
 * right then top to bottom; the gauge under each frame gives the level. `all` raises every
 * level together. `--levels` takes an `oceanKey` and writes that one scene at full size.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PixelCanvas } from '../app/ocean/canvas.ts';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../app/ocean/layers.ts';
import { drawOcean, oceanKey, renderOcean } from '../app/ocean/render.ts';
import { OCEAN_LEVEL_RANGES, type OceanLevels } from '../app/ocean/types.ts';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const outDir = resolve(flag('out') ?? join(tmpdir(), 'ocean-sheets'));
const levelsArg = flag('levels');

const LEVEL_NAMES = Object.keys(OCEAN_LEVEL_RANGES) as (keyof OceanLevels)[];

mkdirSync(outDir, { recursive: true });

// ─── Single scene ────────────────────────────────────────────────────────────

if (levelsArg) {
    const values = levelsArg.split('-').map(Number);
    if (values.length !== LEVEL_NAMES.length || values.some((v) => !Number.isInteger(v))) {
        console.error(`--levels takes ${LEVEL_NAMES.length} integers: ${LEVEL_NAMES.join('-')}`);
        process.exit(1);
    }
    const levels = Object.fromEntries(LEVEL_NAMES.map((name, i) => [name, values[i]]));
    const path = join(outDir, `ocean-${oceanKey(levels)}.png`);
    writeFileSync(path, renderOcean(levels));
    console.log(path);
    process.exit(0);
}

// ─── Contact sheets ──────────────────────────────────────────────────────────

const FRAME_SCALE = 2;
const GAP = 8;
const GAUGE = 10;
const COLUMNS = 4;

type Frame = { levels: Partial<OceanLevels>; level: number; max: number };

function writeSheet(name: string, frames: Frame[]): void {
    const fw = SCENE_WIDTH * FRAME_SCALE;
    const fh = SCENE_HEIGHT * FRAME_SCALE + GAUGE + 6;
    const rows = Math.ceil(frames.length / COLUMNS);
    const sheet = new PixelCanvas(
        COLUMNS * fw + (COLUMNS + 1) * GAP,
        rows * fh + (rows + 1) * GAP,
        '#1e1f22',
    );
    frames.forEach(({ levels, level, max }, i) => {
        const ox = GAP + (i % COLUMNS) * (fw + GAP);
        const oy = GAP + Math.floor(i / COLUMNS) * (fh + GAP);
        sheet.paste(drawOcean(levels), ox, oy, FRAME_SCALE);
        const gaugeY = oy + SCENE_HEIGHT * FRAME_SCALE + 4;
        for (let k = 0; k < max; k++) {
            const color = k < level ? '#f0b232' : '#3a3c42';
            for (let y = 0; y < GAUGE - 2; y++) {
                for (let x = 0; x < GAUGE - 2; x++)
                    sheet.set(ox + k * GAUGE + x, gaugeY + y, color);
            }
        }
    });
    const path = join(outDir, `sheet-${name}.png`);
    writeFileSync(path, sheet.png());
    console.log(path);
}

// The others held low enough to leave the swept level readable.
const BACKDROP: Partial<Record<keyof OceanLevels, Partial<OceanLevels>>> = {
    otters: { bubbles: 3, kelp: 2 },
    bubbles: { otters: 4, kelp: 2 },
    coral: { kelp: 2, otters: 1 },
    kelp: { otters: 1 },
    shells: { kelp: 2, bags: 1 },
    bags: { shells: 4, kelp: 2 },
    octopus: { kelp: 2, shells: 2 },
    nautilus: { kelp: 2, otters: 2 },
};

for (const name of LEVEL_NAMES) {
    const [lo, hi] = OCEAN_LEVEL_RANGES[name];
    writeSheet(
        name,
        Array.from({ length: hi - lo + 1 }, (_, k) => ({
            levels: { ...BACKDROP[name], [name]: lo + k },
            level: lo + k,
            max: hi,
        })),
    );
}

writeSheet(
    'all',
    Array.from({ length: 11 }, (_, k) => ({
        levels: {
            otters: k,
            bubbles: k,
            coral: k,
            kelp: k,
            shells: k,
            bags: Math.ceil(k / 4),
            octopus: Math.floor(k / 4),
            nautilus: k >= 9 ? 1 : 0,
        },
        level: k,
        max: 10,
    })),
);
