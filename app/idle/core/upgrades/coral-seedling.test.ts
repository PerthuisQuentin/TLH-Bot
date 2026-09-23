import { describe, it, expect } from 'vitest';
import { CoralSeedlingUpgrade, CORAL_SEEDLING_COST } from './coral-seedling.ts';
import { CORAL_DIVISOR } from '../prestige/prestige-config.ts';
import { ResourceId, UpgradeKind } from '../types.ts';
import { bn } from '../big-number.ts';

describe('CoralSeedlingUpgrade', () => {
    it('is a one-shot shells purchase that survives a prestige and feeds no income', () => {
        expect(CoralSeedlingUpgrade.costResourceId).toBe(ResourceId.SHELLS);
        expect(CoralSeedlingUpgrade.kind).toBe(UpgradeKind.CUSTOM);
        expect(CoralSeedlingUpgrade.resetOnPrestige).toBe(false);
        expect(CoralSeedlingUpgrade.maxLevel).toBe(1);
    });

    // Derived rather than written down, so rebalancing the prestige threshold moves the door
    // with the room instead of leaving the two a rebalance apart.
    it('costs exactly a tenth of the run peak the first coral needs', () => {
        expect(CORAL_SEEDLING_COST).toBe(CORAL_DIVISOR / 10);
        expect(new CoralSeedlingUpgrade(0).getCost().toString()).toBe(String(CORAL_DIVISOR / 10));
    });

    it('carries its state in its level, and says which side of the door it is on', () => {
        expect(new CoralSeedlingUpgrade(0).getGain().toString()).toBe('0');
        expect(new CoralSeedlingUpgrade(1).getGain().toString()).toBe('1');
        expect(new CoralSeedlingUpgrade(0).formatGain()).toBe('Récif scellé');
        expect(new CoralSeedlingUpgrade(1).formatGain()).toBe('Récif ouvert');
    });

    it('cannot be bought twice however large the balance', () => {
        expect(new CoralSeedlingUpgrade(0).getMaxBuyable(bn('1e30')).levels).toBe(1);
        expect(new CoralSeedlingUpgrade(1).getMaxBuyable(bn('1e30')).levels).toBe(0);
    });
});
