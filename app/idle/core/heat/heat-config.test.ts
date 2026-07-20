import { describe, it, expect } from 'vitest';
import {
    DECAY_LAMBDA,
    MIN_CONTRIBUTION,
    MSG_INCREMENT,
    MAX_CONTRIBUTION,
    createHeatState,
    heatToMultiplier,
    recordActivity,
    advanceDecay,
} from './heat-config.ts';

describe('heatToMultiplier', () => {
    it('buckets heat into the documented ×1.0-×2.0 steps', () => {
        expect(heatToMultiplier(0)).toBe(1.0);
        expect(heatToMultiplier(0.49)).toBe(1.0);
        expect(heatToMultiplier(0.5)).toBe(1.2);
        expect(heatToMultiplier(1.99)).toBe(1.2);
        expect(heatToMultiplier(2)).toBe(1.4);
        expect(heatToMultiplier(3.99)).toBe(1.4);
        expect(heatToMultiplier(4)).toBe(1.6);
        expect(heatToMultiplier(7.99)).toBe(1.6);
        expect(heatToMultiplier(8)).toBe(1.8);
        expect(heatToMultiplier(11.99)).toBe(1.8);
        expect(heatToMultiplier(12)).toBe(2.0);
        expect(heatToMultiplier(100)).toBe(2.0);
    });
});

describe('recordActivity', () => {
    it('a single contributor never raises heat above 0 — the pairwise formula needs a pair', () => {
        const state = createHeatState(1000);
        const heat = recordActivity(state, 'u1', 1000, MSG_INCREMENT);
        expect(heat).toBe(0);
    });

    it('combines two equal contributors pairwise: (sum^2 - sumSq) / 2', () => {
        const state = createHeatState(1000);
        recordActivity(state, 'u1', 1000, 0.5);
        const heat = recordActivity(state, 'u2', 1000, 0.5);

        // sum = 1, sumSq = 0.25 + 0.25 = 0.5 -> (1 - 0.5) / 2 = 0.25
        expect(heat).toBeCloseTo(0.25, 10);
    });

    it('caps a single user contribution at MAX_CONTRIBUTION rather than growing unbounded', () => {
        const state = createHeatState(0);
        for (let i = 0; i < 12; i++) recordActivity(state, 'u1', 0, MSG_INCREMENT);

        expect(state.contributions.get('u1')).toBe(MAX_CONTRIBUTION);
    });
});

describe('decay', () => {
    it('halves a contribution after exactly one half-life', () => {
        const state = createHeatState(0);
        recordActivity(state, 'u1', 0, 1.0);

        const halfLifeMs = (Math.log(2) / DECAY_LAMBDA) * 1000;
        advanceDecay(state, halfLifeMs);

        expect(state.contributions.get('u1')).toBeCloseTo(0.5, 6);
    });

    it('prunes a contribution once it decays below MIN_CONTRIBUTION', () => {
        const state = createHeatState(0);
        recordActivity(state, 'u1', 0, MIN_CONTRIBUTION * 2);
        expect(state.contributions.has('u1')).toBe(true);

        advanceDecay(state, 1_000_000); // 1000 s later, decay factor ~= exp(-6)
        expect(state.contributions.has('u1')).toBe(false);
    });

    it('leaves heat unchanged when no time has passed', () => {
        const state = createHeatState(0);
        recordActivity(state, 'u1', 0, 1);
        const heatBefore = recordActivity(state, 'u2', 0, 1);

        const heatAfter = advanceDecay(state, 0);

        expect(heatAfter).toBe(heatBefore);
    });
});
