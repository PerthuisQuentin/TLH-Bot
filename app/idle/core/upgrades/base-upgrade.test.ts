import { describe, it, expect } from 'vitest';
import { DivingOttersUpgrade } from './diving-otters.ts';
import { BaseUpgrade, MAX_LEVELS_PER_PURCHASE } from './base-upgrade.ts';
import { bn, type BigNum } from '../big-number.ts';

/** The curve the cap exists for: flat cost, so a large balance affords absurdly many levels. */
class FlatCostUpgrade extends BaseUpgrade {
    computeCost(): BigNum {
        return bn(1000);
    }
    computeGain(): BigNum {
        return bn(1);
    }
    computeFormatGain(): string {
        return '+1';
    }
}

describe('BaseUpgrade.getTotalCost', () => {
    it('sums computeCost across the levels being bought, from the current level', () => {
        const upgrade = new DivingOttersUpgrade(0);
        expect(upgrade.getTotalCost(1).toString()).toBe('1000');
        expect(upgrade.getTotalCost(2).toString()).toBe('2200');
        expect(upgrade.getTotalCost(3).toString()).toBe('3640');
    });

    it('starts from the upgrade current level, not always level 0', () => {
        const upgrade = new DivingOttersUpgrade(5);
        expect(upgrade.getCost().toString()).toBe('2488.32');
        expect(upgrade.getTotalCost(1).toString()).toBe('2488.32');
    });
});

describe('BaseUpgrade.getMaxBuyable', () => {
    it('handles the exact affordability boundaries', () => {
        const upgrade = new DivingOttersUpgrade(0);
        expect(upgrade.getMaxBuyable(bn(0)).levels).toBe(0);
        expect(upgrade.getMaxBuyable(bn(999)).levels).toBe(0);
        expect(upgrade.getMaxBuyable(bn(1000)).levels).toBe(1);
        expect(upgrade.getMaxBuyable(bn(2200)).levels).toBe(2);
    });

    it('always lands on the true affordability boundary against its own cost function', () => {
        const upgrade = new DivingOttersUpgrade(0);

        for (const balance of [500, 50_000, 10_000_000]) {
            const { levels } = upgrade.getMaxBuyable(bn(balance));
            // Checked against getTotalCost rather than hand-computed 1.2^n for large n.
            expect(upgrade.getTotalCost(levels).lte(balance)).toBe(true);
            expect(upgrade.getTotalCost(levels + 1).gt(balance)).toBe(true);
        }
    });

    it('returns the cost of the levels it found, so no caller has to re-sum them', () => {
        const upgrade = new DivingOttersUpgrade(3);
        const { levels, totalCost } = upgrade.getMaxBuyable(bn(100_000));

        expect(levels).toBeGreaterThan(1);
        expect(totalCost.toString()).toBe(upgrade.getTotalCost(levels).toString());
    });

    // Without the cap this scans 10^27 levels and never returns. Reaching the assertion
    // at all is the assertion.
    it('caps a cost curve flat enough to afford an unbounded number of levels', () => {
        const upgrade = new FlatCostUpgrade(0);
        const { levels, totalCost } = upgrade.getMaxBuyable(bn('1e30'));

        expect(levels).toBe(MAX_LEVELS_PER_PURCHASE);
        expect(totalCost.toString()).toBe(bn(1000 * MAX_LEVELS_PER_PURCHASE).toString());
    });
});
