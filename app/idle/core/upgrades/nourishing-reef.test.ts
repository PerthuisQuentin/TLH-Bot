import { describe, it, expect } from 'vitest';
import { NourishingReefUpgrade } from './nourishing-reef.ts';
import { ResourceId, UpgradeKind } from '../types.ts';

describe('NourishingReefUpgrade', () => {
    it('is bought with coral, pays in shells, and survives a prestige', () => {
        expect(NourishingReefUpgrade.costResourceId).toBe(ResourceId.CORAL);
        expect(NourishingReefUpgrade.gainResourceId).toBe(ResourceId.SHELLS);
        expect(NourishingReefUpgrade.kind).toBe(UpgradeKind.MULTIPLICATIVE);
        expect(NourishingReefUpgrade.resetOnPrestige).toBe(false);
    });

    it('computeCost: one coral, then x4 per level and an extra x2 every 5', () => {
        const u = new NourishingReefUpgrade(0);
        expect(u.computeCost(0).toString()).toBe('1');
        expect(u.computeCost(1).toString()).toBe('4');
        expect(u.computeCost(4).toString()).toBe('256');
        // The step: 4^5 x 2 rather than 4^5.
        expect(u.computeCost(5).toString()).toBe('2048');
    });

    // The gain of any single level stays under what that same level multiplies the price by.
    // A step on the gain alone would break that rule and the loop would run away.
    it('computeGain: x2 per level, x4 on a step level, neutral at 0', () => {
        const u = new NourishingReefUpgrade(0);
        expect(u.computeGain(0).toString()).toBe('1');
        expect(u.computeGain(1).toString()).toBe('2');
        expect(u.computeGain(4).toString()).toBe('16');
        expect(u.computeGain(5).toString()).toBe('64');
        expect(u.computeGain(10).toString()).toBe('4096');
    });

    it('computeFormatGain renders the multiplier with formatBigNum', () => {
        expect(new NourishingReefUpgrade(0).computeFormatGain(0)).toBe('×1');
        expect(new NourishingReefUpgrade(0).computeFormatGain(5)).toBe('×64');
    });
});
