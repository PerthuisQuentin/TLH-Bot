import { UpgradeKind } from './types.js';
import type { UpgradeDefinition } from './types.js';
import { bn, bnAdd, bnSub, bnMul, bnDiv, bnFloor, bnPow, bnLn, bnLte, bnGt, formatBigNum, type BigNum } from '../commons/big-number.js';

// ─── Calculation helpers ──────────────────────────────────────────────────────

/**
 * Cost to go from `level` to `level + 1`.
 * Follows a geometric series: initialCost * costMultiplier^level.
 * Level is 0-indexed (level 0 → 1 costs initialCost).
 */
export function getUpgradeCost(upgrade: UpgradeDefinition, level: number): BigNum {
    return bnMul(upgrade.initialCost, bnPow(upgrade.costMultiplier, level));
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
    if (upgrade.kind === UpgradeKind.MULTIPLICATIVE) {
        return bnPow(upgrade.baseGain, level);
    }

    if (level <= 0) return bn(0);

    const { baseGain, gainDoublingInterval } = upgrade;
    const completeTiers = Math.floor(level / gainDoublingInterval);
    const remainder = level % gainDoublingInterval;

    const fullTiersGain =
        completeTiers > 0
            ? bnMul(gainDoublingInterval * baseGain, bnSub(bnPow(2, completeTiers), 1))
            : bn(0);

    const remainderGain = bnMul(remainder * baseGain, bnPow(2, completeTiers));

    return bnAdd(fullTiersGain, remainderGain);
}

export function formatUpgradeGain(upgrade: UpgradeDefinition, level: number): string {
    const gain = getUpgradeGain(upgrade, level);
    if (upgrade.kind === UpgradeKind.MULTIPLICATIVE) {
        // Pour les petits multiplicateurs, afficher 2 décimales ; pour les grands, utiliser formatBigNum
        return gain.gte(1000) ? `×${formatBigNum(gain)}` : `×${gain.toFixed(2)}`;
    }
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
    const { initialCost, costMultiplier } = upgrade;
    const ratio = costMultiplier - 1;
    const base = bnMul(initialCost, bnPow(costMultiplier, fromLevel));
    return bnDiv(bnMul(base, bnSub(bnPow(costMultiplier, count), 1)), ratio);
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

    const { initialCost, costMultiplier } = upgrade;
    const ratio = costMultiplier - 1;
    const base = bnMul(initialCost, bnPow(costMultiplier, currentLevel));

    // Solving for N: base * (costMultiplier^N - 1) / ratio <= shells
    // N <= ln(1 + shells * ratio / base) / ln(costMultiplier)
    const inner = bnAdd(1, bnDiv(bnMul(shells, ratio), base));

    const estimate = Math.max(
        0,
        bnFloor(bnDiv(bnLn(inner), bnLn(costMultiplier))).toNumber(),
    );

    // Correct for floating-point drift (at most ±1 off)
    if (bnLte(getUpgradeTotalCost(upgrade, currentLevel, estimate + 1), shells)) return estimate + 1;
    if (estimate > 0 && bnGt(getUpgradeTotalCost(upgrade, currentLevel, estimate), shells)) return estimate - 1;
    return estimate;
}
