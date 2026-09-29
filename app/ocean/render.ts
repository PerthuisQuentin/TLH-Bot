import { PixelCanvas } from './canvas.ts';
import {
    SCENE_HEIGHT,
    SCENE_WIDTH,
    drawBackground,
    drawBags,
    drawDivers,
    drawKelp,
    drawNautilus,
    drawOctopus,
    drawReef,
    drawSeabed,
    drawShellPile,
    drawSurface,
} from './layers.ts';
import { OCEAN_LEVEL_RANGES, type OceanLevels } from './types.ts';

/** 160×90 art pixels become 800×450, a size Discord shows full width. */
export const OCEAN_SCALE = 5;

const LEVEL_NAMES = Object.keys(OCEAN_LEVEL_RANGES) as (keyof OceanLevels)[];

/** Rounds and clamps every level into its range; a missing one is 0. */
export function normalizeLevels(levels: Partial<OceanLevels>): OceanLevels {
    return Object.fromEntries(
        LEVEL_NAMES.map((name) => {
            const [lo, hi] = OCEAN_LEVEL_RANGES[name];
            const value = Math.round(Number(levels[name] ?? 0));
            return [name, Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : lo];
        }),
    ) as OceanLevels;
}

/** The levels in their fixed order, `4-2-7-5-6-1-2-1`: one key per distinct picture. */
export function oceanKey(levels: Partial<OceanLevels>): string {
    const normalized = normalizeLevels(levels);
    return LEVEL_NAMES.map((name) => normalized[name]).join('-');
}

/** The scene at art resolution, for callers that compose several (the contact sheets). */
export function drawOcean(levels: Partial<OceanLevels>): PixelCanvas {
    const l = normalizeLevels(levels);
    const c = new PixelCanvas(SCENE_WIDTH, SCENE_HEIGHT);
    drawBackground(c);
    drawKelp(c, l.kelp);
    drawSeabed(c);
    drawReef(c, l.coral);
    drawShellPile(c, l.shells);
    drawBags(c, l.bags);
    drawOctopus(c, l.octopus);
    drawNautilus(c, l.nautilus);
    drawDivers(c, l.otters, l.bubbles);
    drawSurface(c);
    return c;
}

/** Same levels, same bytes: nothing here reads a clock, a player or `Math.random`. */
export function renderOcean(levels: Partial<OceanLevels>): Buffer<ArrayBuffer> {
    return drawOcean(levels).png(OCEAN_SCALE);
}
