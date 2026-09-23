import { formatBigNum, type BigNum } from './big-number.ts';
import { ResourceId } from './types.ts';

/**
 * How a resource is written where a player sees it. Lives next to the rules for the same
 * reason `UpgradeMeta` does: the name and the symbol belong to the thing, not to whichever
 * command happens to print it.
 */
export type ResourceMeta = {
    emoji: string;
    displayName: string;
};

export const RESOURCE_META: Record<ResourceId, ResourceMeta> = {
    [ResourceId.SHELLS]: { emoji: '🐚', displayName: 'Coquillages' },
    [ResourceId.CORAL]: { emoji: '🪸', displayName: 'Corail' },
};

/**
 * An amount and its currency: the only correct way to write a price or a balance.
 *
 * `formatBigNum(x)` followed by a literal emoji is the trap. It reads fine and it is wrong as
 * soon as the value is not shells, which is how `/shop`, `analyze-upgrade.ts` and the shop
 * pricing lines of `shells-profile.ts` each ended up quoting coral prices in 🐚. Take the
 * currency from the data, `upgrade.costResourceId` or the resource being shown.
 */
export function formatResource(amount: BigNum, resourceId: ResourceId): string {
    return `${formatBigNum(amount)} ${RESOURCE_META[resourceId].emoji}`;
}
