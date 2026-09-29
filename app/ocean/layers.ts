import { PixelCanvas, seededRandom } from './canvas.ts';
import { CoralKind } from './types.ts';
import {
    BAG,
    BAG_PALETTE,
    NAUTILUS,
    NAUTILUS_PALETTE,
    OCTOPUS,
    OCTOPUS_PALETTE,
    OTTER_FLOAT,
    OTTER_PALETTE,
    OTTER_SWIM,
    SHELL,
    SHELL_PALETTES,
} from './sprites.ts';

// Each layer draws from its own seed and fills fixed slots in a fixed order, so a level
// only ever adds to what the level below drew.

export const SCENE_WIDTH = 160;
export const SCENE_HEIGHT = 90;
const SURFACE = 9;

const W = SCENE_WIDTH;
const H = SCENE_HEIGHT;

const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

const dither = (x: number, y: number): number => BAYER[y % 4][x % 4] / 16;

const floorY = (x: number): number => Math.round(80 + 2 * Math.sin(x / 13) + Math.sin(x / 5));

// ─── Slots ───

/** [x, y, facing left], spread first so a low count still fills the frame. */
const OTTER_SLOTS: readonly (readonly [number, number, boolean])[] = [
    [62, 30, false],
    [100, 44, true],
    [34, 48, false],
    [118, 24, true],
    [72, 56, false],
    [40, 18, false],
    [126, 54, true],
    [88, 16, true],
    [18, 34, false],
    [80, 42, false],
];

const KELP_SLOTS = [8, 150, 22, 138, 30, 118, 158, 2, 46, 128];

/** [x, kind, coral level it sprouts at]. */
const REEF_SLOTS: readonly (readonly [number, CoralKind, number])[] = [
    [96, CoralKind.STAGHORN, 2],
    [110, CoralKind.FAN, 2],
    [84, CoralKind.BRAIN, 3],
    [122, CoralKind.TUBES, 4],
    [104, CoralKind.BRAIN, 5],
    [132, CoralKind.STAGHORN, 6],
    [76, CoralKind.FAN, 7],
    [116, CoralKind.STAGHORN, 8],
];

/** [body, tips]. */
const CORAL_COLORS: readonly (readonly [string, string])[] = [
    ['#e2587a', '#ffb3c6'],
    ['#ff8a4c', '#ffd0a8'],
    ['#9d63e8', '#dcc2ff'],
    ['#ffb52e', '#ffe7a8'],
    ['#e8437a', '#ffc0d2'],
    ['#3fc2a0', '#b8f3e2'],
];

const PILE_X = 24;
const OCTOPUS_ROCK_X = 63;

/** The full-size mound as [dx, height, palette]; a level shows the part inside its own dome. */
const PILE: readonly (readonly [number, number, number])[] = (() => {
    const r = seededRandom('pile');
    const points: [number, number, number][] = [[0, 0, 0]];
    for (let i = 0; i < 400; i++) {
        const u = r() * 2 - 1;
        const v = r();
        points.push([u * 20, v * 16 * (1 - u * u), Math.floor(r() * 3)]);
    }
    return points;
})();

// ─── Layers, back to front ───

export function drawBackground(c: PixelCanvas): void {
    for (let y = 0; y < SURFACE; y++) {
        for (let x = 0; x < W; x++) c.set(x, y, y < 4 ? '#a8e0ff' : '#c9edff');
    }

    const bands = ['#7fd6e8', '#5cc3e2', '#3fa8d6', '#2f8ec7', '#2575b5', '#1e5f9e', '#194f89'];
    for (let y = SURFACE; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const t = ((y - SURFACE) / (H - SURFACE)) * (bands.length - 1);
            const band = Math.floor(t) + (dither(x, y) < t - Math.floor(t) ? 1 : 0);
            c.set(x, y, bands[Math.min(bands.length - 1, band)]);
        }
    }

    // Light shafts from the surface, fading with depth.
    const offset = Math.floor(seededRandom('background')() * 40);
    for (let y = SURFACE; y < 70; y++) {
        for (let x = 0; x < W; x++) {
            if ((x + Math.floor(y * 0.45) + offset) % 38 < 5 && dither(x, y) < 0.7) {
                c.blend(x, y, '#ffffff', 0.14 * (1 - (y - SURFACE) / 61));
            }
        }
    }

    // Distant rocks.
    for (let x = 0; x < W; x++) {
        const top = Math.round(66 + 5 * Math.sin(x / 17 + 1) + 3 * Math.sin(x / 6.5));
        for (let y = top; y < H; y++) c.blend(x, y, '#123e6e', 0.45);
    }
}

export function drawKelp(c: PixelCanvas, level: number): void {
    const height = 10 + level * 5.5;
    for (let i = 0; i < level; i++) {
        const kx = KELP_SLOTS[i];
        const r = seededRandom(`kelp:${i}`);
        const stalk = Math.round(height + r() * 8);
        const phase = r() * 6;
        const base = floorY(kx);
        for (let k = 0; k < stalk; k++) {
            const y = base - k;
            const x = kx + Math.round(Math.sin(k / 6 + phase) * 2);
            c.set(x, y, '#3d7a3a');
            c.set(x + 1, y, '#4f9445');
            if (k % 5 === 2) {
                const right = (k / 5) % 2 < 1;
                c.set(x + (right ? 2 : -1), y, '#5fa850');
                c.set(x + (right ? 3 : -2), y - 1, '#6fb85a');
            }
        }
    }
}

export function drawSeabed(c: PixelCanvas): void {
    for (let x = 0; x < W; x++) {
        const top = floorY(x);
        for (let y = top; y < H; y++) {
            const deep = (y - top) / (H - top + 1);
            const color =
                y === top ? '#ecd9a0' : deep > 0.6 && dither(x, y) < 0.5 ? '#bfa46c' : '#d9c28a';
            c.set(x, y, color);
        }
    }

    const r = seededRandom('seabed');
    for (let i = 0; i < 40; i++) {
        const x = Math.floor(r() * W);
        c.set(x, floorY(x) + 2 + Math.floor(r() * 6), '#c3aa72');
    }

    for (const [rx, rw] of [
        [OCTOPUS_ROCK_X, 12],
        [140, 7],
    ]) {
        const base = floorY(rx) + 1;
        for (let dx = 0; dx < rw; dx++) {
            const height = Math.round(Math.sin((dx / (rw - 1)) * Math.PI) * (rw / 2.2)) + 1;
            for (let k = 0; k < height; k++) {
                const color = k === height - 1 ? '#8c98a8' : dx < rw / 2 ? '#6f7c8f' : '#5c687a';
                c.set(rx + dx, base - k, color);
            }
        }
    }
}

/** Grows `size` generations of a tree; each node seeds from its path, so deeper ones never move it. */
function drawStaghorn(
    c: PixelCanvas,
    x: number,
    y: number,
    size: number,
    color: readonly [string, string],
    seed: string,
): void {
    const grow = (
        px: number,
        py: number,
        len: number,
        angle: number,
        gen: number,
        path: string,
    ) => {
        if (gen >= size) return;
        for (let s = 0; s < len; s++) {
            px += Math.cos(angle);
            py += Math.sin(angle);
            c.set(px, py, color[0]);
            if (gen < 3) c.set(px + 1, py, color[0]);
        }
        const r = seededRandom(`${seed}/${path}`);
        if (gen === size - 1) c.set(px, py - 1, color[1]);
        const child = Math.max(2, len - 1);
        grow(px, py, child, angle - 0.5 - r() * 0.3, gen + 1, `${path}L`);
        grow(px, py, child, angle + 0.5 + r() * 0.3, gen + 1, `${path}R`);
    };
    grow(x, y, 5, -Math.PI / 2, 0, '');
}

function drawFan(
    c: PixelCanvas,
    x: number,
    y: number,
    size: number,
    color: readonly [string, string],
): void {
    const rays = 11;
    const len = 2 + size * 2;
    for (let k = 0; k < rays; k++) {
        const angle = -Math.PI / 2 + (k / (rays - 1) - 0.5) * 1.6;
        for (let s = 1; s <= len; s++) {
            c.set(
                x + Math.cos(angle) * s,
                y + Math.sin(angle) * s,
                s === len ? color[1] : color[0],
            );
        }
    }
}

function drawBrain(
    c: PixelCanvas,
    x: number,
    y: number,
    size: number,
    color: readonly [string, string],
): void {
    for (let dy = 0; dy <= size; dy++) {
        for (let dx = -size - 1; dx <= size + 1; dx++) {
            if (dx * dx + (dy * 1.6) ** 2 > (size + 1) ** 2) continue;
            c.set(x + dx, y - dy, (dx + dy * 2) % 3 === 0 ? color[1] : color[0]);
        }
    }
}

function drawTubes(
    c: PixelCanvas,
    x: number,
    y: number,
    size: number,
    color: readonly [string, string],
    seed: string,
): void {
    const r = seededRandom(seed);
    const heights = Array.from({ length: 5 }, () => 3 + Math.floor(r() * 8));
    for (let t = 0; t < Math.min(5, 1 + size); t++) {
        const tx = x - 4 + t * 2;
        const height = Math.min(heights[t], 1 + size * 2);
        for (let k = 0; k < height; k++) c.set(tx, y - k, color[0]);
        c.set(tx, y - height, color[1]);
    }
}

export function drawReef(c: PixelCanvas, level: number): void {
    if (level === 1) {
        const x = REEF_SLOTS[0][0];
        c.set(x, floorY(x) - 1, CORAL_COLORS[0][0]);
        c.set(x, floorY(x) - 2, CORAL_COLORS[0][1]);
        return;
    }
    REEF_SLOTS.forEach(([x, kind, sprout], i) => {
        if (level < sprout) return;
        const size = Math.min(7, level - sprout + 2);
        const color = CORAL_COLORS[i % CORAL_COLORS.length];
        const y = floorY(x);
        const seed = `coral:${i}`;
        if (kind === CoralKind.STAGHORN) drawStaghorn(c, x, y, size, color, seed);
        else if (kind === CoralKind.FAN) drawFan(c, x, y, size, color);
        else if (kind === CoralKind.BRAIN) drawBrain(c, x, y, size, color);
        else drawTubes(c, x, y, size, color, seed);
    });
}

export function drawShellPile(c: PixelCanvas, level: number): void {
    if (level === 0) return;
    const spread = 2 + level * 1.8;
    const height = level * 1.6;
    const base = floorY(PILE_X);
    // The domes are nested, so each level keeps every shell of the one below.
    PILE.filter(([dx, dy]) => dy <= height * (1 - (dx / spread) ** 2))
        .filter((_, i) => i % 2 === 0)
        .sort((a, b) => a[1] - b[1])
        .forEach(([dx, dy, palette]) =>
            c.sprite(
                Math.round(PILE_X + dx) - 1,
                Math.round(base - 1 - dy) - 1,
                SHELL,
                SHELL_PALETTES[palette],
            ),
        );
}

export function drawBags(c: PixelCanvas, level: number): void {
    for (let b = 0; b < level; b++) {
        const x = PILE_X + 24 + b * 6;
        c.sprite(x, floorY(x) - 5, BAG, BAG_PALETTE);
    }
}

export function drawOctopus(c: PixelCanvas, level: number): void {
    if (level === 0) return;
    const base = floorY(OCTOPUS_ROCK_X);
    c.sprite(OCTOPUS_ROCK_X + 1, base - 15, OCTOPUS, OCTOPUS_PALETTE);
    for (let k = 0; k < level; k++) {
        c.sprite(OCTOPUS_ROCK_X - 1 + k * 5, base - 5 - (k % 2), SHELL, SHELL_PALETTES[k % 3]);
    }
}

export function drawNautilus(c: PixelCanvas, level: number): void {
    if (level > 0) c.sprite(128, 30, NAUTILUS, NAUTILUS_PALETTE, true);
}

export function drawDivers(c: PixelCanvas, level: number, bubbles: number): void {
    const slots = OTTER_SLOTS.slice(0, level);
    // Trails first: an otter higher up swims in front of one rising from below.
    slots.forEach(([x, y, flip], i) => {
        const nose = flip ? x : x + 16;
        for (let k = 0; k < bubbles * 2; k++) {
            const by = y - 2 - k * 4;
            if (by <= SURFACE + 1) break;
            const bx = nose + Math.round(Math.sin(k * 1.7 + i) * 1.5);
            if (k < 2) {
                c.blend(bx, by, '#e8fbff', 0.85);
                continue;
            }
            for (const [ox, oy] of [
                [0, -1],
                [-1, 0],
                [1, 0],
                [0, 1],
            ]) {
                c.blend(bx + ox, by + oy, '#e8fbff', 0.8);
            }
            c.set(bx, by - 1, '#ffffff');
        }
    });
    for (const [x, y, flip] of slots) c.sprite(x, y, OTTER_SWIM, OTTER_PALETTE, flip);
}

/** The player's own otter, always afloat, and the waterline drawn over it. */
export function drawSurface(c: PixelCanvas): void {
    const fx = 70;
    c.sprite(fx, SURFACE - 4, OTTER_FLOAT, OTTER_PALETTE);
    for (let x = 0; x < W; x++) {
        c.set(x, SURFACE, (x + 1) % 6 < 3 ? '#e8fbff' : '#b9ecf7');
        if (x >= fx && x < fx + OTTER_FLOAT[0].length) c.blend(x, SURFACE + 1, '#7fd6e8', 0.55);
    }
}
