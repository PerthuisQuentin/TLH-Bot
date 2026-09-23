import { z } from 'zod';

/** What each active day adds to the multiplier. */
export const BONUS_PER_DAY = 0.01;
export const MAX_MULTIPLIER = 2;
/** Active days at which the bonus reaches the cap. */
export const CAP_DAYS = Math.round((MAX_MULTIPLIER - 1) / BONUS_PER_DAY);

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

    /** Active days so far. Never goes down: a missed day only pauses the count. */
    get days(): number {
        return this._days;
    }

    /** At the cap. Days keep counting past it, so lifting it pays the banked ones at once. */
    isCapped(capLifted: boolean): boolean {
        return !capLifted && this._days >= CAP_DAYS;
    }

    /** `capLifted` is the Coquille millénaire, owned by `GameInstance`, not by the rings. */
    getMultiplier(capLifted: boolean): number {
        const multiplier = 1 + this._days * BONUS_PER_DAY;
        return capLifted ? multiplier : Math.min(multiplier, MAX_MULTIPLIER);
    }

    /** Idempotent: several calls the same day add a single ring. */
    addRing(today: string): void {
        if (this._lastDate === today) return;

        this._days += 1;
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
}

/** What a caller outside `GameInstance` may do with the rings: read them, not add one. */
export type ReadonlyGrowthRings = Readonly<Omit<GrowthRings, 'addRing'>>;
