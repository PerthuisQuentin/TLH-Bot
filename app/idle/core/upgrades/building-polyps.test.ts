import { describe, it, expect } from 'vitest';
import { BuildingPolypsUpgrade } from './building-polyps.ts';
import { ResourceId, UpgradeKind } from '../types.ts';

describe('BuildingPolypsUpgrade', () => {
    it('is bought with coral, pays in coral, and survives a prestige', () => {
        expect(BuildingPolypsUpgrade.costResourceId).toBe(ResourceId.CORAL);
        expect(BuildingPolypsUpgrade.gainResourceId).toBe(ResourceId.CORAL);
        expect(BuildingPolypsUpgrade.kind).toBe(UpgradeKind.MULTIPLICATIVE);
        expect(BuildingPolypsUpgrade.resetOnPrestige).toBe(false);
    });

    it('computeCost: one coral, then x2 per level, with no step', () => {
        const u = new BuildingPolypsUpgrade(0);
        expect(u.computeCost(0).toString()).toBe('1');
        expect(u.computeCost(1).toString()).toBe('2');
        expect(u.computeCost(5).toString()).toBe('32');
        expect(u.computeCost(10).toString()).toBe('1024');
    });

    it('computeGain: +10% per level, neutral at 0', () => {
        const u = new BuildingPolypsUpgrade(0);
        expect(u.computeGain(0).toString()).toBe('1');
        expect(u.computeGain(1).toString()).toBe('1.1');
        expect(u.computeGain(10).toFixed(4)).toBe('2.5937');
    });

    // Coral buying coral is a direct loop, with none of the damping the reef gets from the
    // 0.26 exponent. A level must stay strictly under the factor it multiplies its own price
    // by, and here that margin is 1.1 against 2.
    it('keeps every level well under its own price growth', () => {
        const u = new BuildingPolypsUpgrade(0);

        for (let level = 0; level < 20; level += 1) {
            const gainFactor = u.computeGain(level + 1).div(u.computeGain(level));
            const costFactor = u.computeCost(level + 1).div(u.computeCost(level));
            expect(gainFactor.lt(costFactor)).toBe(true);
        }
    });

    it('computeFormatGain renders the multiplier with formatBigNum', () => {
        expect(new BuildingPolypsUpgrade(0).computeFormatGain(0)).toBe('×1');
        expect(new BuildingPolypsUpgrade(0).computeFormatGain(1)).toBe('×1.10');
    });
});
