import { describe, it, expect } from 'vitest';
import { GameInstance, type GameInstanceJson } from './game-instance.ts';
import { pickPurchase, PurchaseStrategy } from './purchase-planner.ts';
import { ResourceId, UpgradeId } from './types.ts';

const SHELLS_TREE = [
    UpgradeId.DIVING_OTTERS,
    UpgradeId.HYDRODYNAMIC_FLIPPERS,
    UpgradeId.HARVEST_BAGS,
];

function player(
    shells: string,
    upgrades: GameInstanceJson['upgrades'] = {},
    coral = '0',
): GameInstance {
    return new GameInstance({
        userId: 'u1',
        resources: { [ResourceId.SHELLS]: shells, [ResourceId.CORAL]: coral },
        stats: { maxShells: '0', totalCoral: '0' },
        growthRings: { days: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
        autoBuyEnabled: true,
        upgrades,
    });
}

// Otters at 10: the next level costs 12 383 for +2 🐚/msg (payback ~6 190 messages).
// Flippers at 0 cost 15 000 for +4.5 (~3 333), bags at 0 cost 100 000 for +15 (~6 667).
const OTTERS_AT_10 = { [UpgradeId.DIVING_OTTERS]: 10 };

describe('pickPurchase', () => {
    it('CHEAPEST takes the cheapest affordable level, whatever it pays back', () => {
        expect(
            pickPurchase(player('20000', OTTERS_AT_10), SHELLS_TREE, PurchaseStrategy.CHEAPEST),
        ).toBe(UpgradeId.DIVING_OTTERS);
    });

    it('BEST_PAYBACK waits for the best payback rather than settling', () => {
        const instance = player('13000', OTTERS_AT_10);
        expect(pickPurchase(instance, SHELLS_TREE, PurchaseStrategy.BEST_PAYBACK)).toBeNull();
        expect(
            pickPurchase(player('15000', OTTERS_AT_10), SHELLS_TREE, PurchaseStrategy.BEST_PAYBACK),
        ).toBe(UpgradeId.HYDRODYNAMIC_FLIPPERS);
    });

    it('BEST_AFFORDABLE_PAYBACK takes the best payback among what the balance covers', () => {
        const strategy = PurchaseStrategy.BEST_AFFORDABLE_PAYBACK;
        expect(pickPurchase(player('13000', OTTERS_AT_10), SHELLS_TREE, strategy)).toBe(
            UpgradeId.DIVING_OTTERS,
        );
        expect(pickPurchase(player('15000', OTTERS_AT_10), SHELLS_TREE, strategy)).toBe(
            UpgradeId.HYDRODYNAMIC_FLIPPERS,
        );
    });

    it('only considers the candidates it is given', () => {
        const instance = player('20000', OTTERS_AT_10);
        expect(
            pickPurchase(instance, [UpgradeId.HARVEST_BAGS], PurchaseStrategy.CHEAPEST),
        ).toBeNull();
        expect(pickPurchase(instance, [], PurchaseStrategy.CHEAPEST)).toBeNull();
    });

    it('returns null when nothing is affordable', () => {
        for (const strategy of Object.values(PurchaseStrategy)) {
            expect(pickPurchase(player('999'), SHELLS_TREE, strategy)).toBeNull();
        }
    });

    it('skips an upgrade no longer on sale, which buyUpgrade would refuse', () => {
        const ids = [UpgradeId.CORAL_SEEDLING];
        expect(pickPurchase(player('1e9'), ids, PurchaseStrategy.CHEAPEST)).toBe(
            UpgradeId.CORAL_SEEDLING,
        );
        expect(
            pickPurchase(
                player('1e9', { [UpgradeId.CORAL_SEEDLING]: 1 }),
                ids,
                PurchaseStrategy.CHEAPEST,
            ),
        ).toBeNull();
    });

    it('skips an upgrade priced in another currency', () => {
        const instance = player('1e9', { [UpgradeId.CORAL_SEEDLING]: 1 }, '1000');
        expect(
            pickPurchase(instance, [UpgradeId.NOURISHING_REEF], PurchaseStrategy.CHEAPEST),
        ).toBeNull();
    });

    it('never mutates the instance', () => {
        const instance = player('20000', OTTERS_AT_10);
        const before = JSON.stringify(instance.toJson());
        for (const strategy of Object.values(PurchaseStrategy)) {
            pickPurchase(instance, SHELLS_TREE, strategy);
        }
        expect(JSON.stringify(instance.toJson())).toBe(before);
    });
});
