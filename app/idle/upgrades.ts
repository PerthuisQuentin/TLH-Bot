import type { UpgradeDefinition } from './types.js';
import { bn, bnAdd, bnLte, formatBigNum, type BigNum } from '../commons/big-number.js';

// ─── Calculation helpers ──────────────────────────────────────────────────────

/**
 * Cost to go from `level` to `level + 1`.
 * Follows a geometric series: initialCost * costMultiplier^level.
 * Level is 0-indexed (level 0 → 1 costs initialCost).
 */
export function getUpgradeCost(upgrade: UpgradeDefinition, level: number): BigNum {
    return upgrade.getCost(level);
}

/**
 * Total cumulative gain provided by an upgrade at a given level.
 *
 * The marginal gain of the k-th purchase (1-indexed) is:
 *   baseGain * 2^floor((k - 1) / gainDoublingInterval)
 *
 * For example, with baseGain=1 and gainDoublingInterval=10:
 *   levels  1–10 each contribute +1  → total at level 10 is 10
 *   levels 11–20 each contribute +2  → total at level 11 is 12
 */
export function getUpgradeGain(upgrade: UpgradeDefinition, level: number): BigNum {
    return upgrade.getGain(level);
}

export function formatUpgradeGain(upgrade: UpgradeDefinition, level: number): string {
    if (upgrade.formatGain) return upgrade.formatGain(level);

    const gain = getUpgradeGain(upgrade, level);
    return `+${formatBigNum(gain)} 🐚/msg`;
}

/**
 * Total cost of buying `count` consecutive levels starting from `fromLevel`.
 * Uses the geometric series closed form.
 */
export function getUpgradeTotalCost(
    upgrade: UpgradeDefinition,
    fromLevel: number,
    count: number,
): BigNum {
    if (count <= 0) return bn(0);

    let total = bn(0);
    for (let i = 0; i < count; i += 1) {
        total = bnAdd(total, getUpgradeCost(upgrade, fromLevel + i));
    }

    return total;
}

/**
 * Maximum number of additional levels that can be purchased starting from
 * `currentLevel` with the given amount of `shells`.
 *
 * Uses a closed-form formula and two boundary checks to correct floating-point drift.
 */
export function getMaxBuyable(
    upgrade: UpgradeDefinition,
    currentLevel: number,
    shells: BigNum,
): number {
    if (bnLte(shells, 0)) return 0;

    const canAfford = (count: number): boolean =>
        bnLte(getUpgradeTotalCost(upgrade, currentLevel, count), shells);

    if (!canAfford(1)) return 0;

    let low = 1;
    let high = 2;

    // Exponential search for an upper bound.
    while (canAfford(high)) {
        low = high;
        high *= 2;
    }

    // Binary search for the maximum affordable count.
    while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        if (canAfford(mid)) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return low;
}
