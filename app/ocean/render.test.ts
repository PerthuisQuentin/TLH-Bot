import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeLevels, oceanKey, renderOcean } from './render.ts';

const hash = (png: Buffer): string => createHash('sha256').update(png).digest('hex').slice(0, 16);

const MID = {
    otters: 4,
    bubbles: 2,
    coral: 7,
    kelp: 5,
    shells: 6,
    bags: 1,
    octopus: 2,
    nautilus: 1,
};

describe('normalizeLevels', () => {
    it('fills a missing level with 0', () => {
        expect(normalizeLevels({ otters: 3 })).toEqual({
            otters: 3,
            bubbles: 0,
            coral: 0,
            kelp: 0,
            shells: 0,
            bags: 0,
            octopus: 0,
            nautilus: 0,
        });
    });

    it('clamps into each range and rounds', () => {
        const levels = normalizeLevels({ otters: 42, bags: 9, coral: -3, kelp: 4.6 });
        expect(levels).toMatchObject({ otters: 10, bags: 3, coral: 0, kelp: 5 });
    });

    it('treats a non-number as the minimum', () => {
        expect(normalizeLevels({ shells: Number.NaN }).shells).toBe(0);
    });
});

describe('oceanKey', () => {
    it('lists the levels in their fixed order', () => {
        expect(oceanKey(MID)).toBe('4-2-7-5-6-1-2-1');
    });

    it('ignores the key order of its input', () => {
        const reversed = Object.fromEntries(Object.entries(MID).reverse());
        expect(oceanKey(reversed)).toBe(oceanKey(MID));
    });

    it('gives one key to levels that clamp to the same picture', () => {
        expect(oceanKey({ otters: 12 })).toBe(oceanKey({ otters: 10 }));
    });
});

describe('renderOcean', () => {
    it('is an 800x450 PNG', () => {
        const png = renderOcean(MID);
        expect(png.readUInt32BE(16)).toBe(800);
        expect(png.readUInt32BE(20)).toBe(450);
    });

    it('gives the same bytes for the same levels', () => {
        expect(hash(renderOcean(MID))).toBe(hash(renderOcean({ ...MID })));
    });

    it('draws every level: raising any one changes the picture', () => {
        // One diver in the base, or a bubble trail would have no one to rise from.
        const base = { otters: 1 };
        const baseHash = hash(renderOcean(base));
        for (const name of Object.keys(MID)) {
            const raised = { ...base, [name]: name === 'otters' ? 2 : 1 };
            expect(hash(renderOcean(raised)), name).not.toBe(baseHash);
        }
    });

    // Pinned against the reviewed prototype. A change here is a visible change to every
    // player's scene: review it with `tsx scripts/render-ocean.ts` before updating a hash.
    it.each([
        ['empty', {}, 'b2666b4291a07f5f'],
        ['seedling', { coral: 1 }, 'cc5b2e29a57f82c8'],
        ['mid game', MID, 'e80d5e9d7d6ca01f'],
        [
            'everything maxed',
            {
                otters: 10,
                bubbles: 10,
                coral: 10,
                kelp: 10,
                shells: 10,
                bags: 3,
                octopus: 3,
                nautilus: 1,
            },
            '1871484a5b909aca',
        ],
    ])('%s is pinned', (_, levels, expected) => {
        expect(hash(renderOcean(levels))).toBe(expected);
    });
});
