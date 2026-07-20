import { describe, it, expect, afterEach, vi } from 'vitest';
import { Streak, MAX_STREAK_DAYS } from './streak.ts';

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

describe('Streak.newInstance', () => {
    it('starts dead: currentValue 0, multiplier x1', () => {
        const streak = Streak.newInstance();
        expect(streak.currentValue).toBe(0);
        expect(streak.getMultiplier()).toBe(1);
    });
});

describe('update', () => {
    it('starts the series at 1 on first use, multiplier still x1 on day one', () => {
        vi.useFakeTimers();
        setDay(0);

        const streak = Streak.newInstance();
        streak.update();

        expect(streak.currentValue).toBe(1);
        expect(streak.getMultiplier()).toBe(1);
    });

    it('is idempotent within the same Paris day', () => {
        vi.useFakeTimers();
        setDay(0);

        const streak = Streak.newInstance();
        streak.update();
        streak.update();

        expect(streak.currentValue).toBe(1);
    });

    it('increments on a consecutive day', () => {
        vi.useFakeTimers();
        setDay(0);
        const streak = Streak.newInstance();
        streak.update();

        setDay(1);
        streak.update();

        expect(streak.currentValue).toBe(2);
    });

    it('resets to 1 rather than continuing after a missed day', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = Streak.today();
        const streak = new Streak({ value: 5, lastDate: today });

        setDay(2); // one full day skipped
        streak.update();

        expect(streak.currentValue).toBe(1);
    });
});

describe('currentValue (read-only)', () => {
    it('stays alive one day after lastDate even without calling update', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = Streak.today();
        const streak = new Streak({ value: 5, lastDate: today });

        setDay(1);
        expect(streak.currentValue).toBe(5);
    });

    it('is dead two days after lastDate without an update', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = Streak.today();
        const streak = new Streak({ value: 5, lastDate: today });

        setDay(2);
        expect(streak.currentValue).toBe(0);
    });
});

describe('getMultiplier', () => {
    it('ramps linearly from x1 (day 1) to x2 (day MAX_STREAK_DAYS)', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = Streak.today();

        expect(new Streak({ value: 1, lastDate: today }).getMultiplier()).toBe(1);
        expect(new Streak({ value: 4, lastDate: today }).getMultiplier()).toBeCloseTo(1.5, 10);
        expect(new Streak({ value: MAX_STREAK_DAYS, lastDate: today }).getMultiplier()).toBe(2);
    });

    it('never exceeds x2 past MAX_STREAK_DAYS', () => {
        vi.useFakeTimers();
        setDay(0);
        const today = Streak.today();

        expect(new Streak({ value: MAX_STREAK_DAYS + 3, lastDate: today }).getMultiplier()).toBe(2);
    });
});
