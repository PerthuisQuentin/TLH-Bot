import { z } from 'zod';

export const MAX_STREAK_DAYS = 7;

export type StreakJson = {
    value: number;
    lastDate: string; // YYYY-MM-DD
};

export const StreakJsonSchema = z.object({
    value: z.number(),
    lastDate: z.string(),
});

export class Streak {
    private _value: number;
    private _lastDate: string;

    constructor(data: StreakJson) {
        this._value = data.value;
        this._lastDate = data.lastDate;
    }

    /**
     * Series length as of now, without mutating. `_value` is only refreshed on a gain,
     * so a reader that trusts it keeps showing a series a missed day already broke.
     */
    get currentValue(): number {
        const today = Streak.today();
        if (this._lastDate === today) return this._value;
        // Still alive: earning today extends it. Two days missed and it is gone.
        if (this._lastDate === Streak.getPreviousDate(today)) return this._value;
        return 0;
    }

    getMultiplier(): number {
        const value = this.currentValue;
        return 1 + Math.min(Math.max(value - 1, 0), MAX_STREAK_DAYS - 1) / (MAX_STREAK_DAYS - 1);
    }

    /** Idempotent: several calls the same Paris day leave the streak untouched. */
    update(): void {
        const today = Streak.today();
        if (this._lastDate === today) return;

        const yesterday = Streak.getPreviousDate(today);
        this._value = this._lastDate === yesterday ? this._value + 1 : 1;
        this._lastDate = today;
    }

    toJson(): StreakJson {
        return { value: this._value, lastDate: this._lastDate };
    }

    static newInstance(): Streak {
        return new Streak({ value: 0, lastDate: '' });
    }

    static today(): string {
        return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    }

    private static getPreviousDate(dateStr: string): string {
        const d = new Date(`${dateStr}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
}

/** What a caller outside `GameInstance` may do with a streak: read it, not advance it. */
export type ReadonlyStreak = Readonly<Omit<Streak, 'update'>>;
