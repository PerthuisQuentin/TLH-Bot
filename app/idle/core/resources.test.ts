import { describe, it, expect } from 'vitest';
import { RESOURCE_META, formatResource } from './resources.ts';
import { ResourceId } from './types.ts';
import { bn } from './big-number.ts';

describe('RESOURCE_META', () => {
    it('describes every ResourceId, so no currency can reach a player unnamed', () => {
        for (const id of Object.values(ResourceId)) {
            expect(RESOURCE_META[id].emoji).toBeTruthy();
            expect(RESOURCE_META[id].displayName).toBeTruthy();
        }
    });
});

describe('formatResource', () => {
    it('writes the amount through formatBigNum, followed by the currency', () => {
        expect(formatResource(bn(1234), ResourceId.SHELLS)).toBe('1.23K 🐚');
        expect(formatResource(bn(2), ResourceId.CORAL)).toBe('2 🪸');
    });

    it('leaves small counts unpadded, so the first prestige pays 1 and not 1.00', () => {
        expect(formatResource(bn(1), ResourceId.CORAL)).toBe('1 🪸');
        expect(formatResource(bn(15), ResourceId.CORAL)).toBe('15 🪸');
        expect(formatResource(bn(15), ResourceId.SHELLS)).toBe('15 🐚');
    });
});
