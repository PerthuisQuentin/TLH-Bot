import { UpgradeKind, UpgradeId, ResourceId, ShopPage } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { CORAL_UNLOCK_HINT, isCoralUnlocked } from './coral-seedling.ts';
import { DivingOttersUpgrade } from './diving-otters.ts';
import { HydrodynamicFlippersUpgrade } from './hydrodynamic-flippers.ts';
import { HarvestBagsUpgrade } from './harvest-bags.ts';
import { bn } from '../big-number.ts';
import type { BigNum } from '../big-number.ts';

/** What each level hands over to the auto-buy: level `n` automates the first `n`. */
const AUTOMATED = [DivingOttersUpgrade, HydrodynamicFlippersUpgrade, HarvestBagsUpgrade];

export const AUTOMATION_ORDER: readonly UpgradeId[] = AUTOMATED.map((cls) => cls.id);

/** Coral price of each level: the 2nd, 4th and 6th prestige, see docs/prestige-design.md. */
export const STEWARD_OCTOPUS_COSTS: readonly number[] = [2, 15, 80];

/**
 * Automates the shells tree one upgrade per level. `CUSTOM`: it feeds no income, its level
 * is read by `GameInstance.automatedUpgradeIds`.
 */
export class StewardOctopusUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.STEWARD_OCTOPUS;
    static readonly kind = UpgradeKind.CUSTOM;
    static readonly costResourceId = ResourceId.CORAL;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Pieuvre intendante';
    static readonly emoji = '🐙';
    static readonly description =
        'Une pieuvre qui gère la boutique à votre place. Chaque niveau lui confie un upgrade de plus, dans l’ordre : loutres, nageoires, puis sacs. Elle achète le plus rentable de ce que vous pouvez payer, et vous laisse le solde quand c’est un upgrade qu’elle ne gère pas.';
    static readonly resetOnPrestige = false;
    static readonly shopPage = ShopPage.TREASURES;
    static readonly maxLevel = AUTOMATED.length;
    static readonly unlockCondition = isCoralUnlocked;
    static readonly unlockHint = CORAL_UNLOCK_HINT;

    // Clamped so a maxed pieuvre still quotes a price rather than `undefined`.
    computeCost(level: number): BigNum {
        return bn(STEWARD_OCTOPUS_COSTS[Math.min(level, STEWARD_OCTOPUS_COSTS.length - 1)]);
    }

    computeGain(level: number): BigNum {
        return bn(level);
    }

    computeFormatGain(level: number): string {
        if (level === 0) return 'Aucune automatisation';
        return `Gère ${AUTOMATED.slice(0, level)
            .map((cls) => `${cls.emoji} ${cls.displayName}`)
            .join(', ')}`;
    }
}
