import { describe, it, expect, afterEach, vi } from 'vitest';
import { rollJackpot, JACKPOT_CHANCE, JACKPOT_MULTIPLIER } from './jackpot.ts';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('jackpot constants', () => {
    it('chance is 1 in 1000, multiplier is x1000', () => {
        expect(JACKPOT_CHANCE).toBe(1 / 1000);
        expect(JACKPOT_MULTIPLIER).toBe(1000);
    });
});

describe('rollJackpot', () => {
    it('triggers when Math.random() lands below the chance', () => {
        vi.spyOn(Math, 'random').mockReturnValue(JACKPOT_CHANCE - 0.0001);
        expect(rollJackpot()).toBe(true);
    });

    it('does not trigger when Math.random() lands at or above the chance', () => {
        vi.spyOn(Math, 'random').mockReturnValue(JACKPOT_CHANCE);
        expect(rollJackpot()).toBe(false);

        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(rollJackpot()).toBe(false);
    });
});
