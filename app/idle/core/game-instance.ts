import { BigNum, bn, bnAdd, bnCeil, bnFloor, bnLt, bnMax, bnMul, bnSub } from './big-number.ts';
import { z } from 'zod';
import { MAX_LEVELS_PER_PURCHASE } from './upgrades/base-upgrade.ts';
import type { BaseUpgrade, ReadonlyUpgrade } from './upgrades/base-upgrade.ts';
import { ResourceId, UpgradeId, UpgradeKind } from './types.ts';
import { UPGRADE_REGISTRY } from './upgrades/upgrade-registry.ts';
import { Streak, type ReadonlyStreak, type StreakJson, StreakJsonSchema } from './streak.ts';
import { computePassiveShells, passiveCreditedUntil } from './passive-income.ts';

export const DEFAULT_SHELLS_PER_MESSAGE = 10;

type ResourcesJson = Partial<Record<ResourceId, string>>;

const ResourcesJsonSchema = z.record(z.enum(ResourceId), z.string().optional());

type StatsJson = { maxShells: string };

const StatsJsonSchema = z.object({ maxShells: z.string() });

type StatsData = { maxShells: BigNum };

type IncomeJson = Partial<Record<ResourceId, string>>;

const IncomeJsonSchema = z.record(z.enum(ResourceId), z.string().optional());

export type GameInstanceJson = {
    userId: string;
    resources: ResourcesJson;
    stats: StatsJson;
    income: IncomeJson;
    streak: StreakJson;
    lastActiveAt: string;
    upgrades: Partial<Record<UpgradeId, number>>;
};

export const GameInstanceJsonSchema = z.object({
    userId: z.string(),
    resources: ResourcesJsonSchema,
    stats: StatsJsonSchema,
    income: IncomeJsonSchema,
    streak: StreakJsonSchema,
    lastActiveAt: z.string(),
    upgrades: z.record(z.enum(UpgradeId), z.number().optional()),
});

export class GameInstance {
    private _userId: string;

    private _resources: Record<ResourceId, BigNum>;
    private _maxShells: BigNum;
    private _income: Record<ResourceId, BigNum>;

    private _streak: Streak;

    private _lastActiveAt: Date;

    private _upgrades: Record<UpgradeId, BaseUpgrade>;

    constructor(data: GameInstanceJson) {
        this._userId = data.userId;
        this._resources = Object.fromEntries(
            Object.values(ResourceId).map((id) => [id, bn(data.resources[id] ?? 0)]),
        ) as Record<ResourceId, BigNum>;
        this._maxShells = bn(data.stats.maxShells);
        this._income = Object.fromEntries(
            Object.values(ResourceId).map((id) => [id, bn(data.income[id] ?? 0)]),
        ) as Record<ResourceId, BigNum>;
        this._streak = new Streak(data.streak);
        this._lastActiveAt = new Date(data.lastActiveAt);
        this._upgrades = Object.fromEntries(
            Object.values(UpgradeId).map((id) => [
                id,
                new UPGRADE_REGISTRY[id](data.upgrades[id] ?? 0),
            ]),
        ) as Record<UpgradeId, BaseUpgrade>;
    }

    get userId(): string {
        return this._userId;
    }

    get resources(): Record<ResourceId, BigNum> {
        return { ...this._resources };
    }

    get stats(): StatsData {
        return { maxShells: this._maxShells };
    }

    get income(): Record<ResourceId, BigNum> {
        return { ...this._income };
    }

    get streak(): Streak {
        return this._streak;
    }

    get upgrades(): Readonly<Record<UpgradeId, ReadonlyUpgrade>> {
        return { ...this._upgrades };
    }

    /** Groups upgrades by `gainResourceId` first, so each resource gets its own additive/multiplicative stack. */
    computeIncome(): Record<ResourceId, BigNum> {
        const result = {} as Record<ResourceId, BigNum>;

        for (const resourceId of Object.values(ResourceId)) {
            const upgrades = Object.values(this._upgrades).filter(
                (u) => u.gainResourceId === resourceId,
            );
            const initial =
                resourceId === ResourceId.SHELLS ? bn(DEFAULT_SHELLS_PER_MESSAGE) : bn(0);

            const additive = upgrades
                .filter((u) => u.kind === UpgradeKind.ADDITIVE)
                .reduce((sum, u) => bnAdd(sum, u.getGain()), bn(0));

            const multiplier = upgrades
                .filter((u) => u.kind === UpgradeKind.MULTIPLICATIVE)
                .reduce((product, u) => bnMul(product, u.getGain()), bn(1));

            result[resourceId] = bnMul(bnAdd(initial, additive), multiplier);
        }

        this._income = result;
        return result;
    }

    /** `maxShells` only tracks shells today — the one resource with a peak that matters for roles. */
    private addResource(id: ResourceId, amount: BigNum): void {
        this._resources[id] = bnAdd(this._resources[id], amount);
        if (id === ResourceId.SHELLS) this._maxShells = bnMax(this._maxShells, this._resources[id]);
    }

    applyShellsGain(multiplier: number): BigNum {
        const base = this._income[ResourceId.SHELLS];
        const variance = bnFloor(bnMul(base, 0.1));
        const rangeSize = bnAdd(bnMul(variance, 2), 1);
        const offset = bnFloor(bnMul(rangeSize, Math.random()));
        const rolled = bnAdd(bnSub(base, variance), offset);
        const amount = bnFloor(bnMul(rolled, multiplier));
        this.addResource(ResourceId.SHELLS, amount);
        return amount;
    }

    applyPassiveIncome(): BigNum {
        const now = new Date();
        const income = this._income[ResourceId.SHELLS];
        const earned = computePassiveShells(income, this._lastActiveAt, now);
        this.addResource(ResourceId.SHELLS, earned);
        // Only up to what `earned` paid for: the rest stays owed instead of being dropped.
        this._lastActiveAt = passiveCreditedUntil(income, this._lastActiveAt, now, earned);
        return earned;
    }

    toJson(): GameInstanceJson {
        return {
            userId: this._userId,
            resources: Object.fromEntries(
                Object.values(ResourceId).map((id) => [id, this._resources[id].toString()]),
            ),
            stats: { maxShells: this._maxShells.toString() },
            income: Object.fromEntries(
                Object.values(ResourceId).map((id) => [id, this._income[id].toString()]),
            ),
            streak: this._streak.toJson(),
            lastActiveAt: this._lastActiveAt.toISOString(),
            upgrades: Object.fromEntries(
                Object.values(UpgradeId).map((id) => [id, this._upgrades[id].level]),
            ),
        };
    }

    static newInstance(userId: string): GameInstance {
        const now = new Date();
        return new GameInstance({
            userId,
            resources: { [ResourceId.SHELLS]: '0' },
            stats: { maxShells: '0' },
            income: { [ResourceId.SHELLS]: DEFAULT_SHELLS_PER_MESSAGE.toString() },
            streak: Streak.newInstance().toJson(),
            lastActiveAt: now.toISOString(),
            upgrades: {},
        });
    }

    updateStreak(): void {
        this._streak.update();
    }

    buyUpgrade(
        upgradeId: UpgradeId,
        quantity: number,
    ): { previousLevel: number; newLevel: number; totalCost: BigNum } | null {
        // Loud rather than silently wrong: `getTotalCost` sums an empty loop below 1, so a
        // 0 would report a successful no-op purchase and a negative one would refund shells
        // while lowering the level. `null` stays reserved for the affordability check.
        // The upper bound is what keeps that sum from looping on a caller-supplied number:
        // this runs inside the storage mutator, holding the guild's file the whole time.
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LEVELS_PER_PURCHASE) {
            throw new RangeError(
                `buyUpgrade: quantity must be an integer in 1..${MAX_LEVELS_PER_PURCHASE}, got ${quantity}`,
            );
        }

        const upgrade = this._upgrades[upgradeId];
        const totalCost = bnCeil(upgrade.getTotalCost(quantity));
        const balance = this._resources[upgrade.costResourceId];
        if (bnLt(balance, totalCost)) return null;

        const previousLevel = upgrade.level;
        this._resources[upgrade.costResourceId] = bnSub(balance, totalCost);
        upgrade.addLevels(quantity);
        this.computeIncome();

        return { previousLevel, newLevel: upgrade.level, totalCost };
    }
}

/**
 * A player as a reader may hold one: every value readable, nothing that changes state.
 * `getGameInstance` hands out a detached copy, so a mutation there would be lost on
 * return — `updateGameInstance` is the only path that writes back.
 */
export type ReadonlyGameInstance = Readonly<
    Omit<
        GameInstance,
        | 'buyUpgrade'
        | 'applyShellsGain'
        | 'applyPassiveIncome'
        | 'updateStreak'
        | 'computeIncome'
        // Dropped and reinstated below: `Readonly` freezes the property, not the object behind it.
        | 'streak'
    >
> & { readonly streak: ReadonlyStreak };
