import { UpgradeKind, UpgradeId, ResourceId, ShopPage } from '../types.ts';
import { BaseUpgrade, type UnlockContext } from './base-upgrade.ts';
import { CoralSeedlingUpgrade, isCoralUnlocked } from './coral-seedling.ts';
import { CAP_DAYS } from '../growth-rings.ts';
import { bn } from '../big-number.ts';
import type { BigNum } from '../big-number.ts';

/** Lands on the 4th prestige, around day 130-140: see docs/prestige-design.md. */
export const MILLENNIAL_SHELL_COST = 16;

/** Sold once the cap is actually in the way, and only to a player who knows coral. */
function isCapInTheWay(ctx: UnlockContext): boolean {
    return isCoralUnlocked(ctx) && ctx.growthRingDays >= CAP_DAYS;
}

/**
 * The one-shot purchase that lifts the ×2 cap on growth rings. `CUSTOM` like the seedling:
 * it feeds no income, its level above 0 is the whole effect, read by
 * `GameInstance.growthRingsCapLifted`.
 */
export class MillennialShellUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.MILLENNIAL_SHELL;
    static readonly kind = UpgradeKind.CUSTOM;
    static readonly costResourceId = ResourceId.CORAL;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Coquille millénaire';
    static readonly emoji = '🌀';
    static readonly description =
        'Une coquille qui ne cesse jamais de grandir. Achat unique : les stries de croissance ne sont plus plafonnées à ×2, chaque jour actif ajoute à nouveau +1 %, y compris ceux déjà accumulés.';
    static readonly resetOnPrestige = false;
    static readonly shopPage = ShopPage.TREASURES;
    static readonly maxLevel = 1;
    static readonly unlockCondition = isCapInTheWay;
    // Names only the seedling, which a locked player already knows, never the coral price.
    static readonly unlockHint = `Procurez-vous ${CoralSeedlingUpgrade.emoji} **${CoralSeedlingUpgrade.displayName}** et atteignez ${CAP_DAYS} jours de stries de croissance pour l'atteindre.`;

    computeCost(): BigNum {
        return bn(MILLENNIAL_SHELL_COST);
    }

    computeGain(level: number): BigNum {
        return bn(level);
    }

    computeFormatGain(level: number): string {
        return level > 0 ? 'Plafond levé' : 'Plafond à ×2';
    }
}
