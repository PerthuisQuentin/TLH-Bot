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
        stats: { maxShells: '0' },
        income: { [ResourceId.SHELLS]: String(DEFAULT_SHELLS_PER_MESSAGE) },
        streak: { value: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
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
        const instance = new GameInstance(makeJson({ stats: { maxShells: '12345' } }));

        expect(instance.stats.runMaxShells.toString()).toBe('12345');
        expect(instance.stats.prestigeCount).toBe(0);
    });

    it('reads both back as stored once the fields exist, independently of maxShells', () => {
        const instance = new GameInstance(
            makeJson({ stats: { maxShells: '12345', runMaxShells: '42', prestigeCount: 3 } }),
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
                stats: { maxShells: '1e12', runMaxShells: '1e12' },
                streak: { value: 7, lastDate: '2026-09-15' },
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
                stats: { maxShells: '1000' },
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
                stats: { maxShells: '1e12', runMaxShells: '1e12' },
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

    it('multiplies the payout by the coral upgrades, which no other stack applies', () => {
        const bare = readyToPrestige().prestige();
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12' },
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
                stats: { maxShells: '1e12', runMaxShells: '1e12' },
                upgrades: { [UpgradeId.BUILDING_POLYPS]: 5, [UpgradeId.CORAL_SEEDLING]: 1 },
            }),
        );
        const quoted = instance.previewPrestige().coral;

        expect(instance.prestige()?.coral.toString()).toBe(quoted.toString());
    });

    it('leaves maxShells, the streak and lastActiveAt alone, so roles and passive income never see it', () => {
        const instance = readyToPrestige();
        const before = instance.toJson();

        instance.prestige();
        const after = instance.toJson();

        expect(after.stats.maxShells).toBe(before.stats.maxShells);
        // Compared as stored rather than read through `currentValue`, which answers relative
        // to today and would make this test depend on the day it runs.
        expect(after.streak).toEqual(before.streak);
        expect(after.lastActiveAt).toBe(before.lastActiveAt);
    });

    it('puts income back to the default, since the upgrades that raised it are gone', () => {
        const instance = readyToPrestige();

        instance.prestige();

        expect(instance.income[ResourceId.SHELLS].toString()).toBe(
            String(DEFAULT_SHELLS_PER_MESSAGE),
        );
    });

    it('leaves the coral upgrades standing, since they are the permanent half', () => {
        const instance = new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12', runMaxShells: '1e12' },
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

describe('buyUpgrade with a maxLevel', () => {
    function rich() {
        return new GameInstance(
            makeJson({
                resources: { [ResourceId.SHELLS]: '1e12' },
                stats: { maxShells: '1e12' },
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

describe('toJson / constructor round-trip', () => {
    it('reproduces the same observable state after a serialize/deserialize cycle', () => {
        const original = new GameInstance(
            makeJson({
                userId: 'round-trip',
                resources: { [ResourceId.SHELLS]: '4242' },
                stats: { maxShells: '9999', runMaxShells: '512', prestigeCount: 2 },
                income: { [ResourceId.SHELLS]: '73.5' },
                streak: { value: 3, lastDate: '2026-08-10' },
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
