import { BigNum, bn, bnAdd, bnCeil, bnFloor, bnLt, bnMax, bnMul, bnSub } from './big-number.ts';
import { z } from 'zod';
import { MAX_LEVELS_PER_PURCHASE } from './upgrades/base-upgrade.ts';
import type { BaseUpgrade, ReadonlyUpgrade, UnlockContext } from './upgrades/base-upgrade.ts';
import { isCoralUnlocked } from './upgrades/coral-seedling.ts';
import { ResourceId, UpgradeId, UpgradeKind } from './types.ts';
import { UPGRADE_REGISTRY } from './upgrades/upgrade-registry.ts';
import {
    GrowthRings,
    GrowthRingsJsonSchema,
    type GrowthRingsJson,
    type ReadonlyGrowthRings,
} from './growth-rings.ts';
import { computePassiveShells, passiveCreditedUntil } from './passive-income.ts';
import { previewPrestige, type PrestigePreview } from './prestige/prestige-config.ts';

export const DEFAULT_SHELLS_PER_MESSAGE = 10;

type ResourcesJson = Partial<Record<ResourceId, string>>;

const ResourcesJsonSchema = z.record(z.enum(ResourceId), z.string().optional());

type StatsJson = { maxShells: string; runMaxShells?: string; prestigeCount?: number };

// The two prestige fields are optional so every file written before prestige existed still
// validates. What they default to is decided in the constructor, not here.
const StatsJsonSchema = z.object({
    maxShells: z.string(),
    runMaxShells: z.string().optional(),
    prestigeCount: z.number().optional(),
});

type StatsData = { maxShells: BigNum; runMaxShells: BigNum; prestigeCount: number };

type IncomeJson = Partial<Record<ResourceId, string>>;

const IncomeJsonSchema = z.record(z.enum(ResourceId), z.string().optional());

export type GameInstanceJson = {
    userId: string;
    resources: ResourcesJson;
    stats: StatsJson;
    income: IncomeJson;
    growthRings: GrowthRingsJson;
    lastActiveAt: string;
    upgrades: Partial<Record<UpgradeId, number>>;
};

export const GameInstanceJsonSchema = z.object({
    userId: z.string(),
    resources: ResourcesJsonSchema,
    stats: StatsJsonSchema,
    income: IncomeJsonSchema,
    growthRings: GrowthRingsJsonSchema,
    lastActiveAt: z.string(),
    upgrades: z.record(z.enum(UpgradeId), z.number().optional()),
});

export type PrestigeOutcome = { coral: BigNum; prestigeCount: number };

/** The formula's answer, plus whether the player has opened the layer at all. */
export type InstancePrestigePreview = PrestigePreview & { unlocked: boolean };

export class GameInstance {
    private _userId: string;

    private _resources: Record<ResourceId, BigNum>;
    private _stats: StatsData;
    private _income: Record<ResourceId, BigNum>;

    private _growthRings: GrowthRings;

    private _lastActiveAt: Date;

    private _upgrades: Record<UpgradeId, BaseUpgrade>;

    constructor(data: GameInstanceJson) {
        this._userId = data.userId;
        this._resources = Object.fromEntries(
            Object.values(ResourceId).map((id) => [id, bn(data.resources[id] ?? 0)]),
        ) as Record<ResourceId, BigNum>;
        this._stats = {
            maxShells: bn(data.stats.maxShells),
            // A file written before prestige existed belongs to a player on their first run,
            // so their run peak is their all-time peak. Defaulting to 0 would hand the whole
            // player base a free prestige on the first load.
            runMaxShells: bn(data.stats.runMaxShells ?? data.stats.maxShells),
            prestigeCount: data.stats.prestigeCount ?? 0,
        };
        this._income = Object.fromEntries(
            Object.values(ResourceId).map((id) => [id, bn(data.income[id] ?? 0)]),
        ) as Record<ResourceId, BigNum>;
        this._growthRings = new GrowthRings(data.growthRings);
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
        return { ...this._stats };
    }

    get income(): Record<ResourceId, BigNum> {
        return { ...this._income };
    }

    get growthRings(): GrowthRings {
        return this._growthRings;
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

    /**
     * What the coral upgrades multiply a prestige payout by. Coral has no income: it is
     * earned in one lump at the trade, so `computeIncome` would seed its stack at 0 and
     * multiply nothing. The multiplicative stack is read here instead, at the only moment
     * it applies.
     */
    get coralMultiplier(): BigNum {
        return Object.values(this._upgrades)
            .filter(
                (u) =>
                    u.gainResourceId === ResourceId.CORAL && u.kind === UpgradeKind.MULTIPLICATIVE,
            )
            .reduce((product, u) => bnMul(product, u.getGain()), bn(1));
    }

    /**
     * Whether the prestige layer is open. Everything coral hangs off this: the `/shop` aisle,
     * the `/shells` block, `/prestige` itself. Keyed on the one upgrade that exists to answer
     * it, rather than on a peak or a prestige count, so the player opens the door themselves.
     */
    get coralUnlocked(): boolean {
        return isCoralUnlocked(this.unlockContext);
    }

    /** The upgrade decides; this only hands it the player's state. */
    isUpgradeUnlocked(id: UpgradeId): boolean {
        return this._upgrades[id].isUnlocked(this.unlockContext);
    }

    isUpgradeVisible(id: UpgradeId): boolean {
        return this._upgrades[id].isVisible(this.unlockContext);
    }

    private get unlockContext(): UnlockContext {
        return {
            upgradeLevels: Object.fromEntries(
                Object.values(UpgradeId).map((id) => [id, this._upgrades[id].level]),
            ) as Record<UpgradeId, number>,
        };
    }

    /**
     * The trade as it stands, with the coral upgrades applied. `canPrestige` folds the unlock
     * in, so a caller that only reads it cannot offer a trade the layer would refuse; the
     * separate `unlocked` is there for callers that word the two refusals differently.
     */
    previewPrestige(): InstancePrestigePreview {
        const preview = previewPrestige(this._stats.runMaxShells, this.coralMultiplier);
        const unlocked = this.coralUnlocked;
        return { ...preview, unlocked, canPrestige: unlocked && preview.canPrestige };
    }

    /**
     * Two peaks, both on shells alone. `maxShells` is the all-time one the roles and the
     * leaderboard read; `runMaxShells` is the one a prestige resets, and what the coral a
     * prestige pays out is computed from.
     */
    private addResource(id: ResourceId, amount: BigNum): void {
        this._resources[id] = bnAdd(this._resources[id], amount);
        if (id !== ResourceId.SHELLS) return;
        this._stats.maxShells = bnMax(this._stats.maxShells, this._resources[id]);
        this._stats.runMaxShells = bnMax(this._stats.runMaxShells, this._resources[id]);
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

    /**
     * Trades the run for coral. The shells balance, the run peak and every shells-priced
     * upgrade go back to zero; coral and `prestigeCount` go up. `maxShells`, the growth rings and
     * `lastActiveAt` are deliberately untouched, which is what keeps the roles, the
     * leaderboard and passive income from noticing a reset happened.
     *
     * Returns `null` when the run pays no coral, leaving the instance exactly as it was.
     */
    prestige(): PrestigeOutcome | null {
        const preview = this.previewPrestige();
        if (!preview.canPrestige) return null;

        this.addResource(ResourceId.CORAL, preview.coral);
        // Assigned rather than credited through addResource, which only ever adds: the point
        // is to wipe the balance, and `maxShells` has to keep the peak being wiped.
        this._resources[ResourceId.SHELLS] = bn(0);
        this._stats.runMaxShells = bn(0);
        this._stats.prestigeCount += 1;

        // Each upgrade says for itself whether it belongs to the run or to the player, so a
        // new one is opted in or out on its own class and nothing here has to change.
        for (const upgrade of Object.values(this._upgrades)) {
            if (upgrade.resetOnPrestige) upgrade.reset();
        }

        this.computeIncome();

        return { coral: preview.coral, prestigeCount: this._stats.prestigeCount };
    }

    toJson(): GameInstanceJson {
        return {
            userId: this._userId,
            resources: Object.fromEntries(
                Object.values(ResourceId).map((id) => [id, this._resources[id].toString()]),
            ),
            stats: {
                maxShells: this._stats.maxShells.toString(),
                runMaxShells: this._stats.runMaxShells.toString(),
                prestigeCount: this._stats.prestigeCount,
            },
            income: Object.fromEntries(
                Object.values(ResourceId).map((id) => [id, this._income[id].toString()]),
            ),
            growthRings: this._growthRings.toJson(),
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
            stats: { maxShells: '0', runMaxShells: '0', prestigeCount: 0 },
            income: { [ResourceId.SHELLS]: DEFAULT_SHELLS_PER_MESSAGE.toString() },
            growthRings: GrowthRings.newInstance().toJson(),
            lastActiveAt: now.toISOString(),
            upgrades: {},
        });
    }

    addGrowthRing(): void {
        this._growthRings.addRing();
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
        // Here and not only in `/shop`, so no caller (the sandbox, the simulations) can buy
        // what the player is not allowed to see.
        if (!upgrade.isUnlocked(this.unlockContext)) return null;
        // A one-shot upgrade bought twice would charge twice for nothing, and `getTotalCost`
        // would happily price the levels past the cap.
        if (upgrade.level + quantity > upgrade.maxLevel) return null;

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
        | 'addGrowthRing'
        | 'computeIncome'
        | 'prestige'
        // Dropped and reinstated below: `Readonly` freezes the property, not the object behind it.
        | 'growthRings'
    >
> & { readonly growthRings: ReadonlyGrowthRings };
