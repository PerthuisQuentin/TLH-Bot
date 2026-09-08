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

describe('toJson / constructor round-trip', () => {
    it('reproduces the same observable state after a serialize/deserialize cycle', () => {
        const original = new GameInstance(
            makeJson({
                userId: 'round-trip',
                resources: { [ResourceId.SHELLS]: '4242' },
                stats: { maxShells: '9999' },
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
        expect(instance.stats.maxShells.toString()).toBe('0');
        expect(instance.income[ResourceId.SHELLS].toString()).toBe(
            String(DEFAULT_SHELLS_PER_MESSAGE),
        );
        for (const id of Object.values(UpgradeId)) {
            expect(instance.upgrades[id].level).toBe(0);
        }
    });
});
