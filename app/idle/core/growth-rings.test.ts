import { describe, it, expect, afterEach, vi } from 'vitest';
import { GrowthRings, MAX_MULTIPLIER } from './growth-rings.ts';

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
    it('starts with no ring and no bonus', () => {
        const rings = GrowthRings.newInstance();
        expect(rings.days).toBe(0);
        expect(rings.getMultiplier(false)).toBe(1);
    });
});

describe('addRing', () => {
    it('adds the first ring, which already counts on day one', () => {
        vi.useFakeTimers();
        setDay(0);

        const rings = GrowthRings.newInstance();
        rings.addRing(GrowthRings.today());

        expect(rings.days).toBe(1);
        expect(rings.getMultiplier(false)).toBeCloseTo(1.01, 10);
    });

    it('is idempotent within the same Paris day', () => {
        vi.useFakeTimers();
        setDay(0);

        const rings = GrowthRings.newInstance();
        rings.addRing(GrowthRings.today());
        rings.addRing(GrowthRings.today());

        expect(rings.days).toBe(1);
    });

    it('adds one ring per active day', () => {
        vi.useFakeTimers();
        setDay(0);
        const rings = GrowthRings.newInstance();
        rings.addRing(GrowthRings.today());

        setDay(1);
        rings.addRing(GrowthRings.today());

        expect(rings.days).toBe(2);
    });

    it('only pauses over missed days, never losing a ring', () => {
        vi.useFakeTimers();
        setDay(0);
        const rings = new GrowthRings({ days: 5, lastDate: GrowthRings.today() });

        setDay(30);
        expect(rings.days).toBe(5);
        rings.addRing(GrowthRings.today());

        expect(rings.days).toBe(6);
    });
});

describe('addRing on a given calendar', () => {
    // The simulations run on a virtual calendar: the date passed in is the only clock.
    it('counts one ring per distinct date, whatever the wall clock says', () => {
        const rings = GrowthRings.newInstance();
        rings.addRing('2030-01-01');
        rings.addRing('2030-01-01');
        rings.addRing('2030-01-05');

        expect(rings.toJson()).toEqual({ days: 2, lastDate: '2030-01-05' });
    });
});

describe('getMultiplier', () => {
    const at = (days: number) => new GrowthRings({ days, lastDate: '' });

    it('adds 1 % per active day', () => {
        expect(at(7).getMultiplier(false)).toBeCloseTo(1.07, 10);
        expect(at(42).getMultiplier(false)).toBeCloseTo(1.42, 10);
    });

    it('reaches the cap at 100 days and stays there', () => {
        expect(at(99).getMultiplier(false)).toBeCloseTo(1.99, 10);
        expect(at(99).isCapped(false)).toBe(false);
        expect(at(100).getMultiplier(false)).toBe(MAX_MULTIPLIER);
        expect(at(100).isCapped(false)).toBe(true);
        expect(at(365).getMultiplier(false)).toBe(MAX_MULTIPLIER);
    });

    it('grows past ×2 once the cap is lifted, banked days included', () => {
        expect(at(120).getMultiplier(true)).toBeCloseTo(2.2, 10);
        expect(at(120).isCapped(true)).toBe(false);
        expect(at(42).getMultiplier(true)).toBeCloseTo(1.42, 10);
    });

    // The count is what the cap lift reads, so it must not stop at the cap.
    it('keeps counting days past the cap', () => {
        vi.useFakeTimers();
        setDay(0);
        const rings = new GrowthRings({ days: 100, lastDate: '' });
        rings.addRing(GrowthRings.today());

        expect(rings.days).toBe(101);
    });
});
