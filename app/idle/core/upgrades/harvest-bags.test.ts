import { describe, it, expect } from 'vitest';
import { HarvestBagsUpgrade } from './harvest-bags.ts';

describe('HarvestBagsUpgrade', () => {
    it('computeCost: base cost, then x2/level and an extra x10 every 10 levels', () => {
        expect(new HarvestBagsUpgrade(0).computeCost(0).toString()).toBe('100000');
        expect(new HarvestBagsUpgrade(0).computeCost(1).toString()).toBe('200000');
        expect(new HarvestBagsUpgrade(0).computeCost(10).toString()).toBe('1024000000');
    });

    it('computeGain: x1.5 multiplicative per level, +1 base', () => {
        expect(new HarvestBagsUpgrade(0).computeGain(0).toString()).toBe('1');
        expect(new HarvestBagsUpgrade(0).computeGain(1).toString()).toBe('1.5');
        expect(new HarvestBagsUpgrade(0).computeGain(10).toString()).toBe('57.6650390625');
    });

    it('computeFormatGain renders the multiplier with formatBigNum', () => {
        expect(new HarvestBagsUpgrade(0).computeFormatGain(0)).toBe('×1.00');
        expect(new HarvestBagsUpgrade(0).computeFormatGain(1)).toBe('×1.50');
        expect(new HarvestBagsUpgrade(0).computeFormatGain(10)).toBe('×57.7');
    });
});
