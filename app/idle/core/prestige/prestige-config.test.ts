import { describe, it, expect } from 'vitest';
import { CORAL_DIVISOR, coralForRun, previewPrestige, runPeakForCoral } from './prestige-config.ts';
import { bn } from '../big-number.ts';

/** No coral upgrade bought: the payout is the bare formula. */
const NONE = bn(1);

describe('coralForRun', () => {
    it('pays nothing below the divisor and exactly one coral at it', () => {
        expect(coralForRun(bn(0), NONE).toString()).toBe('0');
        expect(coralForRun(bn(CORAL_DIVISOR).sub(1), NONE).toString()).toBe('0');
        expect(coralForRun(bn(CORAL_DIVISOR), NONE).toString()).toBe('1');
    });

    it('is sub-linear: doubling the run peak pays nowhere near twice the coral', () => {
        const single = coralForRun(bn('1e12'), NONE);
        const double = coralForRun(bn('2e12'), NONE);

        expect(single.toString()).toBe('36');
        expect(double.toString()).toBe('43');
        expect(double.lt(single.mul(2))).toBe(true);
    });

    it('never decreases as the run peak grows', () => {
        let previous = coralForRun(bn(0), NONE);

        for (let exponent = 8; exponent <= 24; exponent += 1) {
            const current = coralForRun(bn(10).pow(exponent), NONE);
            expect(current.gte(previous)).toBe(true);
            previous = current;
        }
    });

    // Floored once at the end: multiplying a floored payout would lose the fraction that
    // the polyps are there to pay for.
    it('applies the coral multiplier inside the rounding', () => {
        expect(coralForRun(bn('1e12'), bn(1.1).pow(5)).toString()).toBe('58');
        expect(coralForRun(bn('1e12'), bn(1.1)).gt(coralForRun(bn('1e12'), NONE))).toBe(true);
    });
});

describe('runPeakForCoral', () => {
    it('inverts the formula: the first coral costs exactly the divisor', () => {
        expect(runPeakForCoral(bn(1), NONE).toString()).toBe(String(CORAL_DIVISOR));
    });

    it('round-trips exactly at the first coral, and to within one coral higher up', () => {
        expect(coralForRun(runPeakForCoral(bn(1), NONE), NONE).toString()).toBe('1');

        // The floor plus 20 significant digits: one unit of coral sits inside the rounding
        // error, and the 1/0.26 exponent of the inverse amplifies it. Pinned rather than
        // hidden, since the gate never uses it.
        for (const coral of ['7', '3981']) {
            const back = coralForRun(runPeakForCoral(bn(coral), NONE), NONE);
            expect(bn(coral).sub(back).abs().lte(1)).toBe(true);
        }
    });

    it('lowers the first threshold once the polyps are bought', () => {
        expect(runPeakForCoral(bn(1), bn(1.1)).lt(CORAL_DIVISOR)).toBe(true);
    });
});

describe('previewPrestige', () => {
    it('refuses under the first coral, and says how much run peak is missing', () => {
        const preview = previewPrestige(bn('5e5'), NONE);

        expect(preview.canPrestige).toBe(false);
        expect(preview.coral.toString()).toBe('0');
        expect(preview.shellsMissing.toString()).toBe('500000');
    });

    it('allows it from the first coral on, with nothing missing', () => {
        const preview = previewPrestige(bn('1e12'), NONE);

        expect(preview.canPrestige).toBe(true);
        expect(preview.coral.toString()).toBe('36');
        expect(preview.shellsMissing.toString()).toBe('0');
    });

    it('counts the multiplier against what is still missing, not only against the payout', () => {
        const bare = previewPrestige(bn('5e5'), NONE);
        const boosted = previewPrestige(bn('5e5'), bn(1.1).pow(5));

        expect(boosted.shellsMissing.lt(bare.shellsMissing)).toBe(true);
    });
});
