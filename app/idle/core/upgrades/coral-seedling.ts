import { UpgradeKind, UpgradeId, ResourceId, ShopPage } from '../types.ts';
import { BaseUpgrade, type UnlockContext } from './base-upgrade.ts';
import { bn } from '../big-number.ts';
import { CORAL_DIVISOR } from '../prestige/prestige-config.ts';
import type { BigNum } from '../big-number.ts';

/** A tenth of the run peak the first coral costs, so the door shows up well before the room. */
export const CORAL_SEEDLING_COST = CORAL_DIVISOR / 10;

/** Whether the prestige layer is open: the seedling is the one thing that opens it. */
export function isCoralUnlocked(ctx: UnlockContext): boolean {
    return ctx.upgradeLevels[UpgradeId.CORAL_SEEDLING] > 0;
}

/**
 * The one-shot purchase that opens the prestige layer. Until it is bought, coral does not
 * exist as far as the player can see: no coral aisle in `/shop`, no reef block in `/shells`,
 * and `/prestige` declines.
 *
 * It is `CUSTOM` because it produces nothing. The whole effect is that its level is above 0,
 * which `GameInstance.coralUnlocked` reads.
 */
export class CoralSeedlingUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.CORAL_SEEDLING;
    static readonly kind = UpgradeKind.CUSTOM;
    static readonly costResourceId = ResourceId.SHELLS;
    static readonly gainResourceId = ResourceId.CORAL;
    static readonly displayName = 'Bouture de corail';
    static readonly emoji = '🌱';
    static readonly description =
        'Vos loutres rapportent un fragment de corail vivant et le mettent en terre. Achat unique : il ouvre le récif, le prestige et tout ce qui va avec.';
    static readonly resetOnPrestige = false;
    static readonly shopPage = ShopPage.TREASURES;
    static readonly maxLevel = 1;

    // Flat, and charged once: `maxLevel` is what stops a second purchase, not the price.
    computeCost(): BigNum {
        return bn(CORAL_SEEDLING_COST);
    }

    /** The level is the whole state, so the gain is it: 0 locked, 1 unlocked. */
    computeGain(level: number): BigNum {
        return bn(level);
    }

    computeFormatGain(level: number): string {
        return level > 0 ? 'Récif ouvert' : 'Récif scellé';
    }
}

/** What the upgrades behind the seedling tell a player who asks for them too early. */
export const CORAL_UNLOCK_HINT = `Procurez-vous ${CoralSeedlingUpgrade.emoji} **${CoralSeedlingUpgrade.displayName}** pour l'atteindre.`;
