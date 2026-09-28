/**
 * Shared pieces of the idle simulations: CLI parsing, table rendering, playing a day and
 * the naive player built on the core purchase planner. Both `simulate-idle.ts` and `simulate-prestige.ts` drive the
 * same shell tree, and a second copy of the purchase logic would drift from the first.
 */

import { GameInstance } from '../app/idle/core/game-instance.ts';
import { pickPurchase, PurchaseStrategy } from '../app/idle/core/purchase-planner.ts';
import { ALL_UPGRADE_IDS } from '../app/idle/core/upgrades/upgrade-registry.ts';
import { ResourceId, UpgradeId, UpgradeKind } from '../app/idle/core/types.ts';
import { bnCeil, bnGte } from '../app/idle/core/big-number.ts';

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** `null` when the flag is absent or names no strategy. */
export function strategyArg(arg: string): PurchaseStrategy | null {
    if (!arg.startsWith('--strategy=')) return null;
    const value = arg.slice('--strategy='.length).trim().toLowerCase();
    return (Object.values(PurchaseStrategy) as string[]).includes(value)
        ? (value as PurchaseStrategy)
        : null;
}

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

/** The upgrades a shells balance can actually pay for. Coral-priced ones are not in it. */
export function shellPricedUpgradeIds(instance: GameInstance): UpgradeId[] {
    return ALL_UPGRADE_IDS.filter(
        (id) => instance.upgrades[id].costResourceId === ResourceId.SHELLS,
    );
}

/**
 * Spends coral on the cheapest affordable coral upgrade, repeatedly, leaving out `skip`. Naive on purpose, like
 * `tryBuy`: it stands in for a player walking into the shop, not for an optimiser. A one-shot
 * unlock goes first, or cheapest-first would spend its price on the reef and the polyps at
 * every prestige and never buy it.
 */
export function spendCoral(instance: GameInstance, skip: readonly UpgradeId[] = []): void {
    for (;;) {
        const balance = instance.resources[ResourceId.CORAL];
        // Visible only, for the same stall `pickPurchase` avoids.
        const target = ALL_UPGRADE_IDS.filter(
            (id) =>
                instance.upgrades[id].costResourceId === ResourceId.CORAL &&
                instance.isUpgradeVisible(id) &&
                !skip.includes(id),
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
export function tryBuy(
    instance: GameInstance,
    strategy: PurchaseStrategy,
    skip: readonly UpgradeId[] = [],
): UpgradeId | null {
    const gate = ALL_UPGRADE_IDS.find((id) => {
        const upgrade = instance.upgrades[id];
        return (
            !skip.includes(id) &&
            upgrade.kind === UpgradeKind.CUSTOM &&
            instance.isUpgradeVisible(id) &&
            bnGte(instance.resources[upgrade.costResourceId], bnCeil(upgrade.getCost()))
        );
    });
    if (gate) return instance.buyUpgrade(gate, 1) ? gate : null;

    const target = pickPurchase(instance, shellPricedUpgradeIds(instance), strategy);
    if (!target) return null;

    return instance.buyUpgrade(target, 1) ? target : null;
}
