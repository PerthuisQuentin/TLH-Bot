import { describe, expect, it } from 'vitest';
import { GameInstance, type GameInstanceJson } from './core/game-instance.ts';
import { ResourceId, UpgradeId } from './core/types.ts';
import { oceanLevelsFor } from './ocean-levels.ts';

function levelsOf(overrides: Partial<GameInstanceJson> = {}) {
    return oceanLevelsFor(
        new GameInstance({
            userId: 'u1',
            resources: { [ResourceId.SHELLS]: '0' },
            stats: { maxShells: '0', totalCoral: '0' },
            growthRings: { days: 0, lastDate: '' },
            lastActiveAt: new Date().toISOString(),
            autoBuyEnabled: true,
            upgrades: {},
            ...overrides,
        }),
    );
}

const EMPTY = {
    otters: 0,
    bubbles: 0,
    coral: 0,
    kelp: 0,
    shells: 0,
    bags: 0,
    octopus: 0,
    nautilus: 0,
};

describe('oceanLevelsFor', () => {
    it('gives a new player the empty scene, the surface otter alone', () => {
        expect(levelsOf()).toEqual(EMPTY);
    });

    it.each([
        ['otters', { upgrades: { [UpgradeId.DIVING_OTTERS]: 20 } }, 4],
        ['bubbles', { upgrades: { [UpgradeId.HYDRODYNAMIC_FLIPPERS]: 6 } }, 3],
        ['bags', { upgrades: { [UpgradeId.HARVEST_BAGS]: 10 } }, 2],
        ['shells', { resources: { [ResourceId.SHELLS]: '266242' } }, 3],
        ['kelp', { growthRings: { days: 59, lastDate: '2026-09-01' } }, 4],
    ] as const)('moves %s alone', (name, overrides, expected) => {
        expect(levelsOf(overrides)).toEqual({ ...EMPTY, [name]: expected });
    });

    it('counts a threshold as reached on the value itself', () => {
        expect(levelsOf({ upgrades: { [UpgradeId.DIVING_OTTERS]: 4 } }).otters).toBe(1);
        expect(levelsOf({ upgrades: { [UpgradeId.DIVING_OTTERS]: 5 } }).otters).toBe(2);
    });

    it('tops out at 10, far past the last threshold', () => {
        const levels = levelsOf({
            resources: { [ResourceId.SHELLS]: '1e300' },
            upgrades: { [UpgradeId.DIVING_OTTERS]: 5000 },
            growthRings: { days: 900, lastDate: '2026-09-01' },
        });
        expect(levels).toMatchObject({ otters: 10, shells: 10, kelp: 10 });
    });

    it('reads the current balance, so spending shrinks the mound', () => {
        const levels = levelsOf({
            resources: { [ResourceId.SHELLS]: '50' },
            stats: { maxShells: '1e20', totalCoral: '0' },
        });
        expect(levels.shells).toBe(1);
    });

    it('keeps the reef empty before the seedling, whatever coral the file holds', () => {
        const levels = levelsOf({ stats: { maxShells: '0', totalCoral: '500' } });
        expect(levels.coral).toBe(0);
    });

    it('shows the seedling alone at level 1, then grows the reef on the coral ever earned', () => {
        const seedling = { [UpgradeId.CORAL_SEEDLING]: 1 };
        expect(levelsOf({ upgrades: seedling }).coral).toBe(1);
        const levels = levelsOf({
            resources: { [ResourceId.CORAL]: '0' },
            stats: { maxShells: '1e12', totalCoral: '50' },
            upgrades: seedling,
        });
        // 1, 3, 10 and 30 reached: four tiers above the seedling.
        expect(levels.coral).toBe(5);
    });

    it('draws the Pieuvre at its level and the nautilus once the Coquille millénaire is owned', () => {
        const levels = levelsOf({
            upgrades: {
                [UpgradeId.CORAL_SEEDLING]: 1,
                [UpgradeId.STEWARD_OCTOPUS]: 2,
                [UpgradeId.MILLENNIAL_SHELL]: 1,
            },
        });
        expect(levels).toMatchObject({ octopus: 2, nautilus: 1 });
    });
});
