import { UpgradeKind, UpgradeId, ResourceId, ShopPage } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { CORAL_UNLOCK_HINT, isCoralUnlocked } from './coral-seedling.ts';
import { formatBigNum } from '../big-number.ts';
import { computeValue, ModifierTrigger, ModifierOperation } from '../maths.ts';
import type { BigNum } from '../big-number.ts';

/**
 * Multiplies the coral a prestige pays out. Unlike every other upgrade, its gain is not an
 * income: `computeIncome` would hand it a coral stack seeded at 0 and multiply nothing. It is
 * read at the moment of the trade, by `GameInstance.coralMultiplier`.
 */
export class BuildingPolypsUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.BUILDING_POLYPS;
    static readonly kind = UpgradeKind.MULTIPLICATIVE;
    static readonly costResourceId = ResourceId.CORAL;
    static readonly gainResourceId = ResourceId.CORAL;
    static readonly displayName = 'Polypes bâtisseurs';
    static readonly emoji = '🪷';
    static readonly description =
        'Des polypes plus vigoureux bâtissent le récif plus vite. Chaque amélioration augmente de +10% le corail que rapporte un prestige.';
    static readonly resetOnPrestige = false;
    static readonly shopPage = ShopPage.CORAL;
    static readonly unlockCondition = isCoralUnlocked;
    static readonly unlockHint = CORAL_UNLOCK_HINT;

    // Small steps on purpose, and cheap: the reef is the big-ticket buy, this is what the
    // change between two reef levels goes into. Doubling the price per level keeps the pair
    // in balance, see docs/prestige-design.md.
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
                value: 2,
            },
        ]);
    }

    // No step every N levels here, unlike the reef. Coral buying coral is a direct loop, so a
    // level that multiplies the payout as much as it multiplies its own price sits exactly on
    // the runaway line; a step would put those levels over it.
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
                value: 1.1,
            },
        ]);
    }

    computeFormatGain(level: number): string {
        return `×${formatBigNum(this.computeGain(level))}`;
    }
}
