import { z } from 'zod';

export const FULL_BONUS_DAYS = 7;

export type GrowthRingsJson = {
    days: number;
    lastDate: string; // YYYY-MM-DD
};

export const GrowthRingsJsonSchema = z.object({
    days: z.number(),
    lastDate: z.string(),
});

export class GrowthRings {
    private _days: number;
    private _lastDate: string;

    constructor(data: GrowthRingsJson) {
        this._days = data.days;
        this._lastDate = data.lastDate;
    }

    /**
     * Series length as of now, without mutating. `_days` is only refreshed on a gain,
     * so a reader that trusts it keeps showing a series a missed day already broke.
     */
    get currentDays(): number {
        const today = GrowthRings.today();
        if (this._lastDate === today) return this._days;
        // Still alive: earning today extends it. Two days missed and it is gone.
        if (this._lastDate === GrowthRings.getPreviousDate(today)) return this._days;
        return 0;
    }

    getMultiplier(): number {
        const days = this.currentDays;
        return 1 + Math.min(Math.max(days - 1, 0), FULL_BONUS_DAYS - 1) / (FULL_BONUS_DAYS - 1);
    }

    /** Idempotent: several calls the same Paris day leave the rings untouched. */
    addRing(): void {
        const today = GrowthRings.today();
        if (this._lastDate === today) return;

        const yesterday = GrowthRings.getPreviousDate(today);
        this._days = this._lastDate === yesterday ? this._days + 1 : 1;
        this._lastDate = today;
    }

    toJson(): GrowthRingsJson {
        return { days: this._days, lastDate: this._lastDate };
    }

    static newInstance(): GrowthRings {
        return new GrowthRings({ days: 0, lastDate: '' });
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

/** What a caller outside `GameInstance` may do with the rings: read them, not add one. */
export type ReadonlyGrowthRings = Readonly<Omit<GrowthRings, 'addRing'>>;
