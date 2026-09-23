import { describe, it, expect, afterEach, vi } from 'vitest';
import { GrowthRings, FULL_BONUS_DAYS } from './growth-rings.ts';

// Noon UTC stays inside the same Europe/Paris calendar day regardless of DST, and an
// August reference avoids the two DST-transition weekends where +24h could skip a day.
const BASE_MS = new Date('2026-08-10T12:00:00.000Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function setDay(offsetDays: number): void {
    vi.setSystemTime(new Date(BASE_MS + offsetDays * DAY_MS));
}

afterEach(() => {
    vi.useRealTimers();
});

describe('GrowthRings.newInstance', () => {
    it('starts dead: currentValue 0, multiplier x1', () => {
        const rings = GrowthRings.newInstance();
        expect(rings.currentDays).toBe(0);
        expect(rings.getMultiplier()).toBe(1);
    });
});

describe('addRing', () => {
    it('starts the series at 1 on first use, multiplier still x1 on day one', () => {
        vi.useFakeTimers();
        setDay(0);

        const rings = GrowthRings.newInstance();
        rings.addRing();

        expect(rings.currentDays).toBe(1);
        expect(rings.getMultiplier()).toBe(1);
    });

    it('is idempotent within the same Paris day', () => {
        vi.useFakeTimers();
        setDay(0);

        const rings = GrowthRings.newInstance();
        rings.addRing();
        rings.addRing();

        expect(rings.currentDays).toBe(1);
    });

    it('increments on a consecutive day', () => {
        vi.useFakeTimers();
        setDay(0);
        const rings = GrowthRings.newInstance();
        rings.addRing();

        setDay(1);
        rings.addRing();

        expect(rings.currentDays).toBe(2);
    });

    it('resets to 1 rather than continuing after a missed day', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = GrowthRings.today();
        const rings = new GrowthRings({ days: 5, lastDate: today });

        setDay(2); // one full day skipped
        rings.addRing();

        expect(rings.currentDays).toBe(1);
    });
});

describe('currentDays (read-only)', () => {
    it('stays alive one day after lastDate even without calling update', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = GrowthRings.today();
        const rings = new GrowthRings({ days: 5, lastDate: today });

        setDay(1);
        expect(rings.currentDays).toBe(5);
    });

    it('is dead two days after lastDate without an update', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = GrowthRings.today();
        const rings = new GrowthRings({ days: 5, lastDate: today });

        setDay(2);
        expect(rings.currentDays).toBe(0);
    });
});

describe('getMultiplier', () => {
    it('ramps linearly from x1 (day 1) to x2 (day FULL_BONUS_DAYS)', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = GrowthRings.today();

        expect(new GrowthRings({ days: 1, lastDate: today }).getMultiplier()).toBe(1);
        expect(new GrowthRings({ days: 4, lastDate: today }).getMultiplier()).toBeCloseTo(1.5, 10);
        expect(new GrowthRings({ days: FULL_BONUS_DAYS, lastDate: today }).getMultiplier()).toBe(2);
    });

    it('never exceeds x2 past FULL_BONUS_DAYS', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = GrowthRings.today();

        expect(
            new GrowthRings({ days: FULL_BONUS_DAYS + 3, lastDate: today }).getMultiplier(),
        ).toBe(2);
    });
});
