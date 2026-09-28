import { bnCeil, bnDiv, bnGte, bnSub, type BigNum } from './big-number.ts';
import type { ReadonlyGameInstance } from './game-instance.ts';
import { ResourceId, UpgradeId } from './types.ts';

/** How the next shells purchase is chosen. Shared by the auto-buy and the simulations. */
export enum PurchaseStrategy {
    /** The cheapest affordable level. */
    CHEAPEST = 'cheapest',
    /** The level that pays itself back fastest, waited for when not affordable yet. */
    BEST_PAYBACK = 'best-payback',
    /** The level that pays itself back fastest among the affordable ones. */
    BEST_AFFORDABLE_PAYBACK = 'best-affordable-payback',
}

type Candidate = {
    id: UpgradeId;
    cost: BigNum;
    /** Messages needed to earn the level back. Null when the level adds nothing. */
    payback: BigNum | null;
    affordable: boolean;
};

function byPayback(a: Candidate, b: Candidate): number {
    return a.payback!.comparedTo(b.payback!) || a.cost.comparedTo(b.cost);
}

/**
 * The next level to buy among `candidateIds`, or null. Only shells-priced upgrades on sale
 * are considered: a maxed or locked one keeps quoting a price `buyUpgrade` would refuse, and
 * a caller looping on the answer would stall on it with a full balance.
 */
export function pickPurchase(
    instance: ReadonlyGameInstance,
    candidateIds: readonly UpgradeId[],
    strategy: PurchaseStrategy,
): UpgradeId | null {
    const balance = instance.resources[ResourceId.SHELLS];
    const current = instance.income[ResourceId.SHELLS];

    const candidates: Candidate[] = candidateIds
        .filter(
            (id) =>
                instance.upgrades[id].costResourceId === ResourceId.SHELLS &&
                instance.isUpgradeVisible(id),
        )
        .map((id) => {
            const cost = bnCeil(instance.upgrades[id].getCost());
            const delta = bnSub(instance.projectShellsIncome(id), current);
            return {
                id,
                cost,
                payback: delta.lte(0) ? null : bnDiv(cost, delta),
                affordable: bnGte(balance, cost),
            };
        });

    let target: Candidate | undefined;
    switch (strategy) {
        case PurchaseStrategy.CHEAPEST:
            target = candidates
                .filter((c) => c.affordable)
                .sort((a, b) => a.cost.comparedTo(b.cost))[0];
            break;
        case PurchaseStrategy.BEST_PAYBACK:
            // Affordable or not: waiting for it beats settling for a slower payback.
            target = candidates.filter((c) => c.payback !== null).sort(byPayback)[0];
            if (target && !target.affordable) target = undefined;
            break;
        case PurchaseStrategy.BEST_AFFORDABLE_PAYBACK:
            target = candidates
                .filter((c) => c.payback !== null && c.affordable)
                .sort(byPayback)[0];
            break;
    }

    return target?.id ?? null;
}
