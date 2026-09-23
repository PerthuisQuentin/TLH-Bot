import { UpgradeKind, UpgradeId, ResourceId } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { formatBigNum } from '../big-number.ts';
import { computeValue, ModifierTrigger, ModifierOperation } from '../maths.ts';
import type { BigNum } from '../big-number.ts';

export class NourishingReefUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.NOURISHING_REEF;
    static readonly kind = UpgradeKind.MULTIPLICATIVE;
    static readonly costResourceId = ResourceId.CORAL;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Récif nourricier';
    static readonly emoji = '🫧';
    static readonly description =
        'Votre récif abrite toujours plus de coquillages. Chaque amélioration multiplie votre récolte, définitivement : un prestige ne la reprend pas.';
    static readonly resetOnPrestige = false;

    // Same shape as the shells upgrades: a per-level factor plus a step every 5 levels, on
    // both sides. The step has to be on the cost too, or that one level would multiply the
    // gain more than it multiplies the price and the loop runs away.
    computeCost(level: number): BigNum {
        return computeValue(level, [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 4,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 5,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
        ]);
    }

    // Deliberately below the x2 of the cost: a gain that catches up with the price of the
    // next level turns the prestige loop into a runaway. See docs/prestige-design.md.
    // x2 per level, x4 on a step level. Deliberately under the cost growth of the same
    // level: matching it is what turns the prestige loop into a runaway, see
    // docs/prestige-design.md.
    computeGain(level: number): BigNum {
        return computeValue(level, [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 5,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
        ]);
    }

    computeFormatGain(level: number): string {
        return `×${formatBigNum(this.computeGain(level))}`;
    }
}
