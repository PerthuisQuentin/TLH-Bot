import { bn, bnAdd, bnLte } from '../big-number.ts';
import type { BigNum } from '../big-number.ts';
import type { ResourceId, UpgradeId, UpgradeKind } from '../types.ts';

export interface UpgradeMeta {
    id: UpgradeId;
    kind: UpgradeKind;
    costResourceId: ResourceId;
    gainResourceId: ResourceId;
    displayName: string;
    emoji: string;
    description: string;
}

/**
 * Hard bound on a single purchase, and on the scan in `getMaxBuyable`. Out of reach for
 * the current curves — 1000 levels of the cheapest upgrade already cost 10^113 shells —
 * so it exists only to keep a future non-exponential curve from running away: a flat cost
 * of 1000 against a 10^30 balance would otherwise mean 10^27 iterations.
 */
export const MAX_LEVELS_PER_PURCHASE = 1000;

export abstract class BaseUpgrade {
    private _level: number;

    get id(): UpgradeId {
        return (this.constructor as unknown as UpgradeMeta).id;
    }
    get kind(): UpgradeKind {
        return (this.constructor as unknown as UpgradeMeta).kind;
    }
    get costResourceId(): ResourceId {
        return (this.constructor as unknown as UpgradeMeta).costResourceId;
    }
    get gainResourceId(): ResourceId {
        return (this.constructor as unknown as UpgradeMeta).gainResourceId;
    }
    get name(): string {
        return (this.constructor as unknown as UpgradeMeta).displayName;
    }
    get emoji(): string {
        return (this.constructor as unknown as UpgradeMeta).emoji;
    }
    get description(): string {
        return (this.constructor as unknown as UpgradeMeta).description;
    }

    constructor(level: number) {
        this._level = level;
    }

    get level(): number {
        return this._level;
    }

    /** Only mutation point: `GameInstance.buyUpgrade`, which recomputes income right after. */
    addLevels(count: number): void {
        this._level += count;
    }

    abstract computeCost(level: number): BigNum;
    abstract computeGain(level: number): BigNum;
    abstract computeFormatGain(level: number): string;

    formatGain(): string {
        return this.computeFormatGain(this.level);
    }

    getCost(): BigNum {
        return this.computeCost(this.level);
    }

    getGain(): BigNum {
        return this.computeGain(this.level);
    }

    getTotalCost(levelsToBuy: number): BigNum {
        let total = bn(0);
        for (let i = 0; i < levelsToBuy; i++) {
            total = bnAdd(total, this.computeCost(this.level + i));
        }
        return total;
    }

    /**
     * How many levels `shells` buys, and what they cost. One accumulating pass: a binary
     * search re-summed the whole prefix at every probe, so it paid O(N log N) `computeCost`
     * calls for an answer O(N) reaches — and the total cost comes back free, where the
     * caller used to sum it a second time.
     */
    getMaxBuyable(shells: BigNum): { levels: number; totalCost: BigNum } {
        let levels = 0;
        let totalCost = bn(0);

        while (levels < MAX_LEVELS_PER_PURCHASE) {
            const next = bnAdd(totalCost, this.computeCost(this.level + levels));
            if (!bnLte(next, shells)) break;
            totalCost = next;
            levels++;
        }

        return { levels, totalCost };
    }
}

/** What a caller outside `GameInstance` may do with an upgrade: read everything, move nothing. */
export type ReadonlyUpgrade = Readonly<Omit<BaseUpgrade, 'addLevels'>>;
