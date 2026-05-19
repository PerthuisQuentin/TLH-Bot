import { UpgradeKind } from './types.js';
import type { UpgradeDefinition } from './types.js';

// ─── Calculation helpers ──────────────────────────────────────────────────────

/**
 * Cost to go from `level` to `level + 1`.
 * Follows a geometric series: initialCost * costMultiplier^level.
 * Level is 0-indexed (level 0 → 1 costs initialCost).
 */
export function getUpgradeCost(upgrade: UpgradeDefinition, level: number): number {
    return upgrade.initialCost * Math.pow(upgrade.costMultiplier, level);
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
export function getUpgradeGain(upgrade: UpgradeDefinition, level: number): number {
    if (upgrade.kind === UpgradeKind.MULTIPLICATIVE) {
        return Math.pow(upgrade.baseGain, level); // level 0 → 1 (identity, no effect)
    }

    if (level <= 0) return 0;

    // Additive with doubling every gainDoublingInterval levels
    const { baseGain, gainDoublingInterval } = upgrade;
    const completeTiers = Math.floor(level / gainDoublingInterval);
    const remainder = level % gainDoublingInterval;

    // Sum of all complete tiers: each tier t contributes gainDoublingInterval * baseGain * 2^t
    // Sum over t=0..completeTiers-1 = gainDoublingInterval * baseGain * (2^completeTiers - 1)
    const fullTiersGain =
        completeTiers > 0
            ? gainDoublingInterval * baseGain * (Math.pow(2, completeTiers) - 1)
            : 0;

    // Remaining levels in the current (incomplete) tier
    const remainderGain = remainder * baseGain * Math.pow(2, completeTiers);

    return fullTiersGain + remainderGain;
}

export function formatUpgradeGain(upgrade: UpgradeDefinition, level: number): string {
    const gain = getUpgradeGain(upgrade, level);
    return upgrade.kind === UpgradeKind.MULTIPLICATIVE
        ? `×${gain.toFixed(2)}`
        : `+${gain} 🐚/msg`;
}

/**
 * Total cost of buying `count` consecutive levels starting from `fromLevel`.
 * Uses the geometric series closed form.
 */
export function getUpgradeTotalCost(
    upgrade: UpgradeDefinition,
    fromLevel: number,
    count: number,
): number {
    if (count <= 0) return 0;
    const { initialCost, costMultiplier } = upgrade;
    const ratio = costMultiplier - 1;
    const base = initialCost * Math.pow(costMultiplier, fromLevel);
    return base * (Math.pow(costMultiplier, count) - 1) / ratio;
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
    shells: number,
): number {
    if (shells <= 0) return 0;

    const { initialCost, costMultiplier } = upgrade;

    // Total cost of buying N levels from currentLevel (geometric series):
    //   initialCost * costMultiplier^currentLevel * (costMultiplier^N - 1) / (costMultiplier - 1)
    // Solving for N gives the formula below.
    const ratio = costMultiplier - 1;
    const base = initialCost * Math.pow(costMultiplier, currentLevel);

    const estimate = Math.max(
        0,
        Math.floor(Math.log(1 + (shells * ratio) / base) / Math.log(costMultiplier)),
    );

    // Correct for floating-point drift (at most ±1 off)
    if (getUpgradeTotalCost(upgrade, currentLevel, estimate + 1) <= shells) return estimate + 1;
    if (estimate > 0 && getUpgradeTotalCost(upgrade, currentLevel, estimate) > shells) return estimate - 1;
    return estimate;
}
