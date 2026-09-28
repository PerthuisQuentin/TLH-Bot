import { describe, it, expect } from 'vitest';
import {
    AUTOMATION_ORDER,
    STEWARD_OCTOPUS_COSTS,
    StewardOctopusUpgrade,
} from './steward-octopus.ts';
import { CoralSeedlingUpgrade } from './coral-seedling.ts';
import { ResourceId, ShopPage, UpgradeId, UpgradeKind } from '../types.ts';
import { bn } from '../big-number.ts';
import type { UnlockContext } from './base-upgrade.ts';

function ctx(seedling: number): UnlockContext {
    const upgradeLevels = Object.fromEntries(
        Object.values(UpgradeId).map((id) => [id, 0]),
    ) as Record<UpgradeId, number>;
    upgradeLevels[UpgradeId.CORAL_SEEDLING] = seedling;
    return { upgradeLevels, growthRingDays: 0 };
}

describe('StewardOctopusUpgrade', () => {
    it('is a three-level coral purchase on the treasures page that survives a prestige', () => {
        expect(StewardOctopusUpgrade.costResourceId).toBe(ResourceId.CORAL);
        expect(StewardOctopusUpgrade.kind).toBe(UpgradeKind.CUSTOM);
        expect(StewardOctopusUpgrade.shopPage).toBe(ShopPage.TREASURES);
        expect(StewardOctopusUpgrade.resetOnPrestige).toBe(false);
        expect(StewardOctopusUpgrade.maxLevel).toBe(3);
    });

    it('automates otters, then flippers, then bags', () => {
        expect(AUTOMATION_ORDER).toEqual([
            UpgradeId.DIVING_OTTERS,
            UpgradeId.HYDRODYNAMIC_FLIPPERS,
            UpgradeId.HARVEST_BAGS,
        ]);
    });

    it('prices each level from its table and stops at the third', () => {
        STEWARD_OCTOPUS_COSTS.forEach((cost, level) => {
            expect(new StewardOctopusUpgrade(level).getCost().toString()).toBe(String(cost));
        });
        expect(new StewardOctopusUpgrade(0).getMaxBuyable(bn('1e9')).levels).toBe(3);
        expect(new StewardOctopusUpgrade(3).getMaxBuyable(bn('1e9')).levels).toBe(0);
    });

    it('unlocks with the seedling', () => {
        const upgrade = new StewardOctopusUpgrade(0);
        expect(upgrade.isUnlocked(ctx(0))).toBe(false);
        expect(upgrade.isUnlocked(ctx(1))).toBe(true);
    });

    it('never names coral in the hint a locked player reads, beyond the seedling', () => {
        const hint = StewardOctopusUpgrade.unlockHint.replace(CoralSeedlingUpgrade.displayName, '');
        expect(hint).not.toMatch(/🪸|corail|coraux/i);
    });

    it('names what it manages', () => {
        expect(new StewardOctopusUpgrade(0).formatGain()).toBe('Aucune automatisation');
        expect(new StewardOctopusUpgrade(1).formatGain()).toBe('Gère 🦦 Loutres plongeuses');
        expect(new StewardOctopusUpgrade(3).formatGain()).toBe(
            'Gère 🦦 Loutres plongeuses, 🐟 Nageoires hydrodynamiques, 🎒 Sacs de récolte XXL',
        );
    });
});
