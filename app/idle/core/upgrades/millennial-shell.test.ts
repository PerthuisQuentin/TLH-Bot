import { describe, it, expect } from 'vitest';
import { MillennialShellUpgrade, MILLENNIAL_SHELL_COST } from './millennial-shell.ts';
import { CoralSeedlingUpgrade } from './coral-seedling.ts';
import { ResourceId, ShopPage, UpgradeId, UpgradeKind } from '../types.ts';
import { CAP_DAYS } from '../growth-rings.ts';
import { bn } from '../big-number.ts';
import type { UnlockContext } from './base-upgrade.ts';

function ctx(seedling: number, growthRingDays: number): UnlockContext {
    const upgradeLevels = Object.fromEntries(
        Object.values(UpgradeId).map((id) => [id, 0]),
    ) as Record<UpgradeId, number>;
    upgradeLevels[UpgradeId.CORAL_SEEDLING] = seedling;
    return { upgradeLevels, growthRingDays };
}

describe('MillennialShellUpgrade', () => {
    it('is a one-shot coral purchase on the treasures page that survives a prestige', () => {
        expect(MillennialShellUpgrade.costResourceId).toBe(ResourceId.CORAL);
        expect(MillennialShellUpgrade.kind).toBe(UpgradeKind.CUSTOM);
        expect(MillennialShellUpgrade.shopPage).toBe(ShopPage.TREASURES);
        expect(MillennialShellUpgrade.resetOnPrestige).toBe(false);
        expect(MillennialShellUpgrade.maxLevel).toBe(1);
    });

    it('costs a flat 16 coral, once', () => {
        expect(new MillennialShellUpgrade(0).getCost().toString()).toBe(
            String(MILLENNIAL_SHELL_COST),
        );
        expect(new MillennialShellUpgrade(0).getMaxBuyable(bn('1e9')).levels).toBe(1);
        expect(new MillennialShellUpgrade(1).getMaxBuyable(bn('1e9')).levels).toBe(0);
    });

    it('unlocks only with the seedling and once the rings reach the cap', () => {
        const upgrade = new MillennialShellUpgrade(0);
        expect(upgrade.isUnlocked(ctx(1, CAP_DAYS))).toBe(true);
        expect(upgrade.isUnlocked(ctx(1, CAP_DAYS - 1))).toBe(false);
        // Without the seedling coral does not exist for the player, whatever their days.
        expect(upgrade.isUnlocked(ctx(0, 500))).toBe(false);
    });

    // The seedling's own name is public; anything else about coral would give the layer away.
    it('never names coral in the hint a locked player reads, beyond the seedling', () => {
        const hint = MillennialShellUpgrade.unlockHint.replace(
            CoralSeedlingUpgrade.displayName,
            '',
        );
        expect(hint).not.toMatch(/🪸|corail|coraux/i);
    });

    it('says which side of the cap the player is on', () => {
        expect(new MillennialShellUpgrade(0).formatGain()).toBe('Plafond à ×2');
        expect(new MillennialShellUpgrade(1).formatGain()).toBe('Plafond levé');
    });
});
