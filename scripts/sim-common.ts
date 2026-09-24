/**
 * Shared pieces of the idle simulations: CLI parsing, table rendering, playing a day and
 * the auto-buy strategies. Both `simulate-idle.ts` and `simulate-prestige.ts` drive the
 * same shell tree, and a second copy of the purchase logic would drift from the first.
 */

import { DEFAULT_SHELLS_PER_MESSAGE, GameInstance } from '../app/idle/core/game-instance.ts';
import { ALL_UPGRADE_IDS } from '../app/idle/core/upgrades/upgrade-registry.ts';
import { ResourceId, UpgradeId, UpgradeKind } from '../app/idle/core/types.ts';
import {
    bn,
    bnAdd,
    bnCeil,
    bnDiv,
    bnGte,
    bnMul,
    bnSub,
    type BigNum,
} from '../app/idle/core/big-number.ts';

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** `null` when the flag is absent or its value is not a finite number. */
export function numberArg(arg: string, prefix: string): number | null {
    if (!arg.startsWith(prefix)) return null;
    const value = Number(arg.slice(prefix.length));
    return Number.isFinite(value) ? value : null;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
    const widths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
    );
    const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ');
    return [line(headers), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(line)].join(
        '\n',
    );
}

// ─── Playing a day ───────────────────────────────────────────────────────────

const EPOCH_MS = Date.UTC(2026, 0, 1, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date of simulated day `day`, so growth rings count days off the wall clock. */
export function virtualDate(day: number): string {
    return new Date(EPOCH_MS + Math.floor(day) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * `messages` effective messages on simulated day `day`, the player being active that day:
 * the day's growth ring first, as in the real pipeline, so the income already carries it.
 * Heat, passive income and the jackpot stay folded into `messages`.
 */
export function playMessages(instance: GameInstance, day: number, messages: number): void {
    instance.addGrowthRing(virtualDate(day));
    instance.applyShellsGain(messages);
}

// ─── Purchases ───────────────────────────────────────────────────────────────

export type PurchaseStrategy = 'cheapest' | 'best-payback';

/** The upgrades a shells balance can actually pay for. Coral-priced ones are not in it. */
export function shellPricedUpgradeIds(instance: GameInstance): UpgradeId[] {
    return ALL_UPGRADE_IDS.filter(
        (id) => instance.upgrades[id].costResourceId === ResourceId.SHELLS,
    );
}

/**
 * Shells income as it would be with one extra level on `bumpId`. GameInstance only
 * computes the income it actually has, and answering "what if" must not mutate it.
 */
export function projectedIncome(instance: GameInstance, bumpId?: UpgradeId): BigNum {
    let additive = bn(DEFAULT_SHELLS_PER_MESSAGE);
    let multiplier = bn(1);

    for (const id of ALL_UPGRADE_IDS) {
        const upgrade = instance.upgrades[id];
        if (upgrade.gainResourceId !== ResourceId.SHELLS) continue;
        const gain = upgrade.computeGain(upgrade.level + (id === bumpId ? 1 : 0));
        // Mirrors `computeIncome`, which matches the two kinds rather than falling through:
        // a CUSTOM gain of 0 landing in the multiplicative branch would zero the income.
        if (upgrade.kind === UpgradeKind.ADDITIVE) additive = bnAdd(additive, gain);
        else if (upgrade.kind === UpgradeKind.MULTIPLICATIVE) multiplier = bnMul(multiplier, gain);
    }

    return bnMul(bnMul(additive, multiplier), instance.growthRingsMultiplier);
}

type Candidate = {
    id: UpgradeId;
    cost: BigNum;
    /** Messages needed to earn the level back. Null when the level adds nothing. */
    payback: BigNum | null;
};

function candidates(instance: GameInstance): Candidate[] {
    const current = instance.income[ResourceId.SHELLS];

    // A maxed or locked upgrade keeps quoting a price it will not honour. Left in, the
    // cheapest-first strategy would pick it, `buyUpgrade` would refuse, and `tryBuy` would
    // report "nothing affordable" from then on — the auto-buyer stalls with a full balance.
    return shellPricedUpgradeIds(instance)
        .filter((id) => instance.isUpgradeVisible(id))
        .map((id) => {
            const cost = bnCeil(instance.upgrades[id].getCost());
            const delta = bnSub(projectedIncome(instance, id), current);
            return { id, cost, payback: delta.lte(0) ? null : bnDiv(cost, delta) };
        });
}

/**
 * Spends coral on the cheapest affordable coral upgrade, repeatedly. Naive on purpose, like
 * `tryBuy`: it stands in for a player walking into the shop, not for an optimiser. A one-shot
 * unlock goes first, or cheapest-first would spend its price on the reef and the polyps at
 * every prestige and never buy it.
 */
export function spendCoral(instance: GameInstance): void {
    for (;;) {
        const balance = instance.resources[ResourceId.CORAL];
        // Visible only, for the same stall `candidates` avoids.
        const target = ALL_UPGRADE_IDS.filter(
            (id) =>
                instance.upgrades[id].costResourceId === ResourceId.CORAL &&
                instance.isUpgradeVisible(id),
        )
            .map((id) => ({
                id,
                cost: bnCeil(instance.upgrades[id].getCost()),
                unlock: instance.upgrades[id].kind === UpgradeKind.CUSTOM,
            }))
            .filter((candidate) => bnGte(balance, candidate.cost))
            .sort((a, b) => Number(b.unlock) - Number(a.unlock) || a.cost.comparedTo(b.cost))[0];

        if (!target || !instance.buyUpgrade(target.id, 1)) return;
    }
}

/**
 * Buys one level if the strategy finds a target it can afford.
 *
 * A `CUSTOM` upgrade is taken first and outside the strategy, in whatever currency it costs:
 * it adds no income, so `best-payback` would rank it last forever and never open the prestige
 * layer, nor lift the growth rings cap.
 */
export function tryBuy(instance: GameInstance, strategy: PurchaseStrategy): UpgradeId | null {
    const gate = ALL_UPGRADE_IDS.find((id) => {
        const upgrade = instance.upgrades[id];
        return (
            upgrade.kind === UpgradeKind.CUSTOM &&
            instance.isUpgradeVisible(id) &&
            bnGte(instance.resources[upgrade.costResourceId], bnCeil(upgrade.getCost()))
        );
    });
    if (gate) return instance.buyUpgrade(gate, 1) ? gate : null;

    const all = candidates(instance);
    let target: Candidate | undefined;

    if (strategy === 'best-payback') {
        // Best payback overall, affordable or not: waiting for it beats settling
        // for a level that pays itself back more slowly.
        target = all
            .filter((c) => c.payback !== null)
            .sort((a, b) => a.payback!.comparedTo(b.payback!) || a.cost.comparedTo(b.cost))[0];
        if (!target || !bnGte(instance.resources[ResourceId.SHELLS], target.cost)) return null;
    } else {
        target = all
            .filter((c) => bnGte(instance.resources[ResourceId.SHELLS], c.cost))
            .sort((a, b) => a.cost.comparedTo(b.cost))[0];
        if (!target) return null;
    }

    return instance.buyUpgrade(target.id, 1) ? target.id : null;
}
