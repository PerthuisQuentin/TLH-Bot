import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    GameInstance,
    DEFAULT_SHELLS_PER_MESSAGE,
    type GameInstanceJson,
} from './game-instance.ts';
import { ResourceId, UpgradeId } from './types.ts';
import { MAX_LEVELS_PER_PURCHASE } from './upgrades/base-upgrade.ts';
import { bn, bnGte, bnLte } from './big-number.ts';
import { computePassiveShells } from './passive-income.ts';

afterEach(() => {
    vi.useRealTimers();
});

function makeJson(overrides: Partial<GameInstanceJson> = {}): GameInstanceJson {
    return {
        userId: 'u1',
        resources: { [ResourceId.SHELLS]: '0' },
        stats: { maxShells: '0', totalCoral: '0' },
        growthRings: { days: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
        autoBuyEnabled: true,
        upgrades: {},
        ...overrides,
    };
}

describe('computeIncome', () => {
    it('seeds only SHELLS with DEFAULT_SHELLS_PER_MESSAGE, at level 0 for every upgrade', () => {
        const instance = new GameInstance(makeJson());
        const income = instance.computeIncome();

        expect(income[ResourceId.SHELLS].toString()).toBe(String(DEFAULT_SHELLS_PER_MESSAGE));
        expect(income[ResourceId.CORAL].toString()).toBe('0');
        expect(Object.keys(income)).toEqual(Object.values(ResourceId));
    });

    it('combines additive and multiplicative gains, grouped by gainResourceId', () => {
        const instance = new GameInstance(
            makeJson({
                upgrades: {
                    [UpgradeId.DIVING_OTTERS]: 2, // additive: +1 * 2 = +2
                    [UpgradeId.HYDRODYNAMIC_FLIPPERS]: 1, // multiplicative: x1.15
                },
            }),
        );

        const income = instance.computeIncome();

        // (10 + 2) * 1.15 = 13.8
        expect(income[ResourceId.SHELLS].toString()).toBe('13.8');
    });

    it('multiplies the shells income by the growth rings, and nothing else', () => {
        const instance = new GameInstance(
            makeJson({
                growthRings: { days: 50, lastDate: '' },
                upgrades: { [UpgradeId.DIVING_OTTERS]: 2 },
            }),
        );

        // (10 + 2) * 1.5
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('18');
        expect(instance.income[ResourceId.CORAL].toString()).toBe('0');
    });

    it('is derived on load and never persisted', () => {
        const instance = new GameInstance(makeJson({ growthRings: { days: 100, lastDate: '' } }));

        expect(instance.income[ResourceId.SHELLS].toString()).toBe('20');
        expect(instance.toJson()).not.toHaveProperty('income');
    });

    it('is idempotent and matches the live income getter after being called', () => {
        const instance = new GameInstance(makeJson({ upgrades: { [UpgradeId.DIVING_OTTERS]: 5 } }));

        const first = instance.computeIncome();
        const second = instance.computeIncome();

        expect(first[ResourceId.SHELLS].toString()).toBe(second[ResourceId.SHELLS].toString());
        expect(instance.income[ResourceId.SHELLS].toString()).toBe(
            first[ResourceId.SHELLS].toString(),
        );
    });
});

describe('projectShellsIncome', () => {
    it('matches the income one more level would give, without changing anything', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e9' },
                growthRings: { days: 30, lastDate: '2026-01-01' },
                upgrades: { [UpgradeId.DIVING_OTTERS]: 9, [UpgradeId.HARVEST_BAGS]: 2 },
            }),
        );

        for (const id of [
            UpgradeId.DIVING_OTTERS,
            UpgradeId.HYDRODYNAMIC_FLIPPERS,
            UpgradeId.HARVEST_BAGS,
        ]) {
            const copy = new GameInstance(instance.toJson());
            const projected = copy.projectShellsIncome(id);
            expect(copy.income[ResourceId.SHELLS].toString()).toBe(
                instance.income[ResourceId.SHELLS].toString(),
            );
            copy.buyUpgrade(id, 1);
            expect(projected.toString()).toBe(copy.income[ResourceId.SHELLS].toString());
        }
    });
});

describe('buyUpgrade', () => {
    it('debits resources[upgrade.costResourceId], increments the level and recomputes income', () => {
        const instance = new GameInstance(makeJson({ resources: { [ResourceId.SHELLS]: '1000' } }));

        const upgrade = instance.upgrades[UpgradeId.DIVING_OTTERS];
        const result = instance.buyUpgrade(UpgradeId.DIVING_OTTERS, 1);

        expect(result).toEqual({ previousLevel: 0, newLevel: 1, totalCost: bn(1000) });
        expect(instance.resources[upgrade.costResourceId].toString()).toBe('0');
        // (10 + 1) * 1 = 11
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('11');
    });

    it('throws on a quantity outside the buyable range, leaving the instance untouched', () => {
        const instance = new GameInstance(
            makeJson({ resources: { [ResourceId.SHELLS]: '1000000' } }),
        );

        for (const quantity of [0, -3, 1.5, NaN, Infinity, MAX_LEVELS_PER_PURCHASE + 1]) {
            expect(() => instance.buyUpgrade(UpgradeId.DIVING_OTTERS, quantity)).toThrow(
                RangeError,
            );
        }

        expect(instance.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(0);
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('1000000');
    });

    it('exposes upgrade levels as read-only, so income can never silently desync', () => {
        const instance = new GameInstance(makeJson());
        const upgrade = instance.upgrades[UpgradeId.DIVING_OTTERS];

        expect(() => {
            // @ts-expect-error a level only moves through buyUpgrade, which recomputes income
            upgrade.level = 999;
        }).toThrow(TypeError);
    });

    it('returns null and leaves the instance untouched when funds are insufficient', () => {
        const instance = new GameInstance(makeJson({ resources: { [ResourceId.SHELLS]: '500' } }));

        const result = instance.buyUpgrade(UpgradeId.DIVING_OTTERS, 1);

        expect(result).toBeNull();
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('500');
        expect(instance.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(0);
        expect(instance.income[ResourceId.SHELLS].toString()).toBe(
            String(DEFAULT_SHELLS_PER_MESSAGE),
        );
    });
});

describe('applyShellsGain', () => {
    it('stays within the documented ±10 % variance around income.shells', () => {
        const instance = new GameInstance(makeJson());
        const base = instance.income[ResourceId.SHELLS];
        const variance = base.mul(0.1).floor();
        const lowerBound = base.sub(variance);
        const upperBound = base.add(variance);

        for (let i = 0; i < 200; i++) {
            const amount = instance.applyShellsGain(1);
            expect(bnGte(amount, lowerBound)).toBe(true);
            expect(bnLte(amount, upperBound)).toBe(true);
        }
    });

    it('credits ResourceId.SHELLS and tracks stats.maxShells as a peak that never decreases on spend', () => {
        const instance = new GameInstance(makeJson({ resources: { [ResourceId.SHELLS]: '1000' } }));

        for (let i = 0; i < 20; i++) instance.applyShellsGain(1);
        const peakBeforeSpend = instance.stats.maxShells;

        instance.buyUpgrade(UpgradeId.DIVING_OTTERS, 1);

        expect(instance.resources[ResourceId.SHELLS].lt(peakBeforeSpend)).toBe(true);
        expect(instance.stats.maxShells.toString()).toBe(peakBeforeSpend.toString());
    });
});

describe('stats.runMaxShells / stats.prestigeCount', () => {
    it('defaults runMaxShells to maxShells, so loading a pre-prestige file is not a free prestige', () => {
        const instance = new GameInstance(
            makeJson({ stats: { maxShells: '12345', totalCoral: '0' } }),
        );

        expect(instance.stats.runMaxShells.toString()).toBe('12345');
        expect(instance.stats.prestigeCount).toBe(0);
    });

    it('reads both back as stored once the fields exist, independently of maxShells', () => {
        const instance = new GameInstance(
            makeJson({
                stats: {
                    maxShells: '12345',
                    runMaxShells: '42',
                    prestigeCount: 3,
                    totalCoral: '0',
                },
            }),
        );

        expect(instance.stats.maxShells.toString()).toBe('12345');
        expect(instance.stats.runMaxShells.toString()).toBe('42');
        expect(instance.stats.prestigeCount).toBe(3);
    });

    it('tracks the same peak as maxShells as long as nothing has reset it', () => {
        const instance = new GameInstance(makeJson({ resources: { [ResourceId.SHELLS]: '1000' } }));

        for (let i = 0; i < 20; i++) instance.applyShellsGain(1);
        instance.buyUpgrade(UpgradeId.DIVING_OTTERS, 1);

        expect(instance.stats.runMaxShells.toString()).toBe(instance.stats.maxShells.toString());
    });
});

describe('applyPassiveIncome', () => {
    it('credits shells within the bounds computePassiveShells gives for the elapsed window, and advances lastActiveAt', () => {
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const instance = new GameInstance(makeJson({ lastActiveAt: twoDaysAgo.toISOString() }));
        const income = instance.income[ResourceId.SHELLS];

        const beforeCall = new Date();
        const earned = instance.applyPassiveIncome();
        const afterCall = new Date();

        const lowerBound = computePassiveShells(income, twoDaysAgo, beforeCall);
        const upperBound = computePassiveShells(income, twoDaysAgo, afterCall);

        expect(bnGte(earned, lowerBound)).toBe(true);
        expect(bnLte(earned, upperBound)).toBe(true);
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe(earned.toString());

        const lastActiveAt = new Date(instance.toJson().lastActiveAt);
        expect(lastActiveAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
        expect(lastActiveAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    // Every earning event runs this, so the interval is short and the credit floors to 0.
    // Moving lastActiveAt to now anyway used to drop the fraction each time, and a member
    // chatting steadily was paid no passive income at all.
    it('keeps a sub-shell interval owed instead of dropping it, so short steps still pay', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const instance = new GameInstance(
            makeJson({ lastActiveAt: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
        );

        // 3 min at the default 10/h income is half a shell.
        vi.setSystemTime(new Date('2026-01-01T00:03:00.000Z'));
        expect(instance.applyPassiveIncome().toString()).toBe('0');

        // The first half was kept, so the two halves now add up to a whole shell.
        vi.setSystemTime(new Date('2026-01-01T00:06:00.000Z'));
        expect(instance.applyPassiveIncome().toString()).toBe('1');
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('1');
    });
});

describe('prestige', () => {
    function readyToPrestige() {
        return new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                growthRings: { days: 7, lastDate: '2026-09-15' },
                upgrades: {
                    [UpgradeId.DIVING_OTTERS]: 40,
                    [UpgradeId.HYDRODYNAMIC_FLIPPERS]: 10,
                    [UpgradeId.HARVEST_BAGS]: 3,
                    [UpgradeId.CORAL_SEEDLING]: 1,
                },
            }),
        );
    }

    it('returns null and changes nothing at all when the run has not earned a coral', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1000' },
                stats: { maxShells: '1000', totalCoral: '0' },
                upgrades: { [UpgradeId.DIVING_OTTERS]: 3 },
            }),
        );
        const before = instance.toJson();

        expect(instance.prestige()).toBeNull();
        expect(instance.toJson()).toEqual(before);
    });

    it('refuses while the layer is locked, whatever the run peak is worth', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                upgrades: { [UpgradeId.DIVING_OTTERS]: 40 },
            }),
        );
        const before = instance.toJson();
        const preview = instance.previewPrestige();

        expect(instance.coralUnlocked).toBe(false);
        expect(preview.unlocked).toBe(false);
        expect(preview.canPrestige).toBe(false);
        // The formula still answers: only the gate is shut, and the payout is what it would be.
        expect(preview.coral.gt(0)).toBe(true);
        expect(instance.prestige()).toBeNull();
        expect(instance.toJson()).toEqual(before);
    });

    it('credits coral, wipes the balance, the run peak and every shells-priced upgrade', () => {
        const instance = readyToPrestige();

        const outcome = instance.prestige();

        expect(outcome?.coral.toString()).toBe('36');
        expect(outcome?.prestigeCount).toBe(1);
        expect(instance.resources[ResourceId.CORAL].toString()).toBe('36');
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('0');
        expect(instance.stats.runMaxShells.toString()).toBe('0');
        expect(instance.stats.prestigeCount).toBe(1);
        for (const id of Object.values(UpgradeId)) {
            if (instance.upgrades[id].resetOnPrestige) expect(instance.upgrades[id].level).toBe(0);
        }
        // The seedling is the door, not part of the run: losing it would re-lock the layer.
        expect(instance.upgrades[UpgradeId.CORAL_SEEDLING].level).toBe(1);
    });

    it('adds the payout to totalCoral', () => {
        const instance = readyToPrestige();
        const payout = instance.previewPrestige().coral;

        instance.prestige();

        expect(instance.stats.totalCoral.toString()).toBe(payout.toString());
    });

    it('multiplies the payout by the coral upgrades, which no other stack applies', () => {
        const bare = readyToPrestige().prestige();
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                upgrades: { [UpgradeId.BUILDING_POLYPS]: 5, [UpgradeId.CORAL_SEEDLING]: 1 },
            }),
        );

        expect(instance.coralMultiplier.toFixed(5)).toBe('1.61051');
        expect(instance.prestige()?.coral.gt(bare!.coral)).toBe(true);
    });

    // The preview is what `/prestige` quotes before the player confirms. If it read the bare
    // formula while `prestige` read the multiplied one, the trade would beat its own quote.
    it('previews exactly what the trade then pays', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                upgrades: { [UpgradeId.BUILDING_POLYPS]: 5, [UpgradeId.CORAL_SEEDLING]: 1 },
            }),
        );
        const quoted = instance.previewPrestige().coral;

        expect(instance.prestige()?.coral.toString()).toBe(quoted.toString());
    });

    it('leaves maxShells, the growth rings and lastActiveAt alone, so roles and passive income never see it', () => {
        const instance = readyToPrestige();
        const before = instance.toJson();

        instance.prestige();
        const after = instance.toJson();

        expect(after.stats.maxShells).toBe(before.stats.maxShells);
        // Compared as stored rather than read through `currentValue`, which answers relative
        // to today and would make this test depend on the day it runs.
        expect(after.growthRings).toEqual(before.growthRings);
        expect(after.lastActiveAt).toBe(before.lastActiveAt);
    });

    it('puts income back to the default times the rings, since the upgrades that raised it are gone', () => {
        const instance = readyToPrestige();

        instance.prestige();

        // 7 ring days survive the reset.
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('10.7');
    });

    it('leaves the coral upgrades standing, since they are the permanent half', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                upgrades: {
                    [UpgradeId.DIVING_OTTERS]: 40,
                    [UpgradeId.NOURISHING_REEF]: 2,
                    [UpgradeId.CORAL_SEEDLING]: 1,
                },
            }),
        );

        instance.prestige();

        expect(instance.upgrades[UpgradeId.NOURISHING_REEF].level).toBe(2);
        expect(instance.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(0);
    });

    it('accumulates coral and prestigeCount across runs', () => {
        const instance = readyToPrestige();

        instance.prestige();
        for (let i = 0; i < 40; i++) instance.applyShellsGain(1e11);
        const second = instance.prestige();

        expect(second).not.toBeNull();
        expect(instance.stats.prestigeCount).toBe(2);
        expect(instance.resources[ResourceId.CORAL].gt(15)).toBe(true);
    });
});

describe('unlock conditions', () => {
    const withCoral = (upgrades: GameInstanceJson['upgrades'] = {}) =>
        new GameInstance(makeJson({ resources: { [ResourceId.CORAL]: '1000' }, upgrades }));

    it('keeps the coral upgrades locked until the seedling is bought', () => {
        const locked = withCoral();
        expect(locked.isUpgradeUnlocked(UpgradeId.NOURISHING_REEF)).toBe(false);
        expect(locked.isUpgradeUnlocked(UpgradeId.BUILDING_POLYPS)).toBe(false);
        expect(locked.isUpgradeUnlocked(UpgradeId.DIVING_OTTERS)).toBe(true);

        const unlocked = withCoral({ [UpgradeId.CORAL_SEEDLING]: 1 });
        expect(unlocked.isUpgradeUnlocked(UpgradeId.NOURISHING_REEF)).toBe(true);
        expect(unlocked.isUpgradeUnlocked(UpgradeId.BUILDING_POLYPS)).toBe(true);
    });

    // Enforced in the model, not only in `/shop`: the sandbox and the simulations buy
    // through here too.
    it('refuses to sell a locked upgrade, whatever the balance', () => {
        const instance = withCoral();
        expect(instance.buyUpgrade(UpgradeId.NOURISHING_REEF, 1)).toBeNull();
        expect(instance.upgrades[UpgradeId.NOURISHING_REEF].level).toBe(0);
        expect(instance.resources[ResourceId.CORAL].toString()).toBe('1000');
    });

    it('takes a bought one-shot off sale while leaving it unlocked', () => {
        const instance = withCoral({ [UpgradeId.CORAL_SEEDLING]: 1 });
        expect(instance.isUpgradeUnlocked(UpgradeId.CORAL_SEEDLING)).toBe(true);
        expect(instance.isUpgradeVisible(UpgradeId.CORAL_SEEDLING)).toBe(false);
        expect(instance.isUpgradeVisible(UpgradeId.NOURISHING_REEF)).toBe(true);
    });
});

describe('addGrowthRing', () => {
    it('raises the income on the first ring of the day, and only then', () => {
        const instance = new GameInstance(
            makeJson({ growthRings: { days: 9, lastDate: '2026-09-23' } }),
        );

        instance.addGrowthRing('2026-09-24');
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('11');

        instance.addGrowthRing('2026-09-24');
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('11');
    });
});

describe('growth rings cap', () => {
    const player = (days: number, upgrades: GameInstanceJson['upgrades'] = {}) =>
        new GameInstance(
            makeJson({
                resources: { [ResourceId.CORAL]: '100' },
                growthRings: { days, lastDate: '' },
                upgrades: { [UpgradeId.CORAL_SEEDLING]: 1, ...upgrades },
            }),
        );

    it('keeps the Coquille millénaire locked until the rings reach the cap', () => {
        expect(player(99).isUpgradeUnlocked(UpgradeId.MILLENNIAL_SHELL)).toBe(false);
        expect(player(99).buyUpgrade(UpgradeId.MILLENNIAL_SHELL, 1)).toBeNull();
        expect(player(100).isUpgradeUnlocked(UpgradeId.MILLENNIAL_SHELL)).toBe(true);
    });

    it('pays the banked days at once when the cap is lifted', () => {
        const instance = player(120);
        expect(instance.growthRingsMultiplier).toBe(2);
        expect(instance.growthRingsCapped).toBe(true);

        expect(instance.buyUpgrade(UpgradeId.MILLENNIAL_SHELL, 1)).not.toBeNull();

        expect(instance.growthRingsMultiplier).toBeCloseTo(2.2, 10);
        expect(instance.growthRingsCapped).toBe(false);
        expect(instance.isUpgradeVisible(UpgradeId.MILLENNIAL_SHELL)).toBe(false);
        expect(instance.income[ResourceId.SHELLS].toString()).toBe('22');
    });

    it('keeps the lift across a prestige', () => {
        const instance = new GameInstance(
            makeJson({
                stats: { maxShells: '1e12', runMaxShells: '1e12', totalCoral: '0' },
                growthRings: { days: 120, lastDate: '' },
                upgrades: { [UpgradeId.CORAL_SEEDLING]: 1, [UpgradeId.MILLENNIAL_SHELL]: 1 },
            }),
        );

        expect(instance.prestige()).not.toBeNull();
        expect(instance.growthRingsCapLifted).toBe(true);
    });
});

describe('buyUpgrade with a maxLevel', () => {
    function rich() {
        return new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', totalCoral: '0' },
            }),
        );
    }

    it('sells the one level, then refuses and charges nothing', () => {
        const instance = rich();

        expect(instance.buyUpgrade(UpgradeId.CORAL_SEEDLING, 1)).not.toBeNull();
        const afterFirst = instance.resources[ResourceId.SHELLS].toString();

        expect(instance.buyUpgrade(UpgradeId.CORAL_SEEDLING, 1)).toBeNull();
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe(afterFirst);
        expect(instance.upgrades[UpgradeId.CORAL_SEEDLING].level).toBe(1);
    });

    // Without the cap this would price two levels and debit for both.
    it('refuses a quantity that would overshoot the cap, rather than clamping it', () => {
        const instance = rich();
        const balance = instance.resources[ResourceId.SHELLS].toString();

        expect(instance.buyUpgrade(UpgradeId.CORAL_SEEDLING, 2)).toBeNull();
        expect(instance.upgrades[UpgradeId.CORAL_SEEDLING].level).toBe(0);
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe(balance);
    });
});

describe('runAutoBuy', () => {
    function withOctopus(
        level: number,
        shells: string,
        upgrades: GameInstanceJson['upgrades'] = {},
    ) {
        return new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: shells },
                upgrades: {
                    [UpgradeId.CORAL_SEEDLING]: 1,
                    [UpgradeId.STEWARD_OCTOPUS]: level,
                    ...upgrades,
                },
            }),
        );
    }

    it('automates one more upgrade per level, in order', () => {
        expect(withOctopus(0, '0').automatedUpgradeIds).toEqual([]);
        expect(withOctopus(1, '0').automatedUpgradeIds).toEqual([UpgradeId.DIVING_OTTERS]);
        expect(withOctopus(3, '0').automatedUpgradeIds).toEqual([
            UpgradeId.DIVING_OTTERS,
            UpgradeId.HYDRODYNAMIC_FLIPPERS,
            UpgradeId.HARVEST_BAGS,
        ]);
    });

    it('buys nothing while switched off, and resumes once switched back on', () => {
        const instance = withOctopus(1, '1000000');

        instance.setAutoBuy(false);
        expect(instance.runAutoBuy()).toEqual({});
        expect(instance.toJson().autoBuyEnabled).toBe(false);

        instance.setAutoBuy(true);
        expect(instance.runAutoBuy()[UpgradeId.DIVING_OTTERS]).toBeGreaterThan(0);
    });

    it('starts switched on for a new player', () => {
        expect(GameInstance.newInstance('u1').autoBuyEnabled).toBe(true);
    });

    it('buys nothing without the Pieuvre intendante', () => {
        const instance = withOctopus(0, '1e9');
        const before = JSON.stringify(instance.toJson());

        expect(instance.runAutoBuy()).toEqual({});
        expect(JSON.stringify(instance.toJson())).toBe(before);
    });

    it('buys an automated upgrade while it is the best pick, until the balance runs out', () => {
        // Flippers cost 15 000: at 5 000, the otters are the only level the balance covers.
        const instance = withOctopus(1, '5000');
        const bought = instance.runAutoBuy();

        expect(Object.keys(bought)).toEqual([UpgradeId.DIVING_OTTERS]);
        expect(instance.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(bought.divingOtters);
        expect(instance.upgrades[UpgradeId.HYDRODYNAMIC_FLIPPERS].level).toBe(0);
        const nextOtter = instance.upgrades[UpgradeId.DIVING_OTTERS].getCost();
        expect(bnLte(instance.resources[ResourceId.SHELLS], nextOtter)).toBe(true);
    });

    it('leaves the balance for a manual upgrade that pays back better', () => {
        // Otters at 10 pay back in ~6 190 messages, flippers in ~3 333, and only otters are automated.
        const instance = withOctopus(1, '15000', { [UpgradeId.DIVING_OTTERS]: 10 });

        expect(instance.runAutoBuy()).toEqual({});
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('15000');
    });

    it('takes the fastest payback the balance covers', () => {
        // Otters at 10 pay back in ~6 190 messages, flippers in ~3 333: flippers win at 15 000.
        const instance = withOctopus(2, '15000', { [UpgradeId.DIVING_OTTERS]: 10 });

        expect(instance.runAutoBuy()).toEqual({ [UpgradeId.HYDRODYNAMIC_FLIPPERS]: 1 });
    });

    it('stops at MAX_LEVELS_PER_PURCHASE levels in one call', () => {
        const instance = withOctopus(3, '1e300');

        const levels = Object.values(instance.runAutoBuy()).reduce((sum, n) => sum + n, 0);
        expect(levels).toBe(MAX_LEVELS_PER_PURCHASE);
    });
});

describe('stats.totalCoral', () => {
    it('is left alone by a coral purchase, unlike the balance', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.CORAL]: '10' },
                stats: { maxShells: '1e12', runMaxShells: '0', prestigeCount: 1, totalCoral: '10' },
                upgrades: { [UpgradeId.CORAL_SEEDLING]: 1 },
            }),
        );

        expect(instance.buyUpgrade(UpgradeId.BUILDING_POLYPS, 1)).not.toBeNull();

        expect(instance.resources[ResourceId.CORAL].toString()).toBe('9');
        expect(instance.stats.totalCoral.toString()).toBe('10');
    });

    it('starts at 0 for a new player', () => {
        expect(GameInstance.newInstance('u').stats.totalCoral.toString()).toBe('0');
    });
});

describe('toJson / constructor round-trip', () => {
    it('reproduces the same observable state after a serialize/deserialize cycle', () => {
        const original = new GameInstance(
            makeJson({
                userId: 'round-trip',
                resources: { [ResourceId.SHELLS]: '4242' },
                stats: {
                    maxShells: '9999',
                    runMaxShells: '512',
                    prestigeCount: 2,
                    totalCoral: '77',
                },
                growthRings: { days: 3, lastDate: '2026-08-10' },
                upgrades: {
                    [UpgradeId.DIVING_OTTERS]: 6,
                    [UpgradeId.HYDRODYNAMIC_FLIPPERS]: 2,
                    [UpgradeId.HARVEST_BAGS]: 1,
                },
            }),
        );

        const roundTripped = new GameInstance(original.toJson());

        expect(roundTripped.userId).toBe(original.userId);
        expect(roundTripped.resources[ResourceId.SHELLS].toString()).toBe(
            original.resources[ResourceId.SHELLS].toString(),
        );
        expect(roundTripped.stats.maxShells.toString()).toBe(original.stats.maxShells.toString());
        expect(roundTripped.stats.runMaxShells.toString()).toBe('512');
        expect(roundTripped.stats.prestigeCount).toBe(2);
        expect(roundTripped.stats.totalCoral.toString()).toBe('77');
        expect(roundTripped.income[ResourceId.SHELLS].toString()).toBe(
            original.income[ResourceId.SHELLS].toString(),
        );
        expect(roundTripped.toJson()).toEqual(original.toJson());
    });
});

describe('newInstance', () => {
    it('starts every resource, stat and upgrade level at zero, income seeded at the default', () => {
        const instance = GameInstance.newInstance('fresh');

        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('0');
        expect(instance.resources[ResourceId.CORAL].toString()).toBe('0');
        expect(instance.stats.maxShells.toString()).toBe('0');
        expect(instance.stats.runMaxShells.toString()).toBe('0');
        expect(instance.stats.prestigeCount).toBe(0);
        expect(instance.income[ResourceId.SHELLS].toString()).toBe(
            String(DEFAULT_SHELLS_PER_MESSAGE),
        );
        for (const id of Object.values(UpgradeId)) {
            expect(instance.upgrades[id].level).toBe(0);
        }
    });
});
