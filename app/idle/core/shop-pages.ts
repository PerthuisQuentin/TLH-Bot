import { RESOURCE_META } from './resources.ts';
import { ResourceId, ShopPage } from './types.ts';

/** How a `/shop` page is named where a player sees it, `/shop page:<name>` included. */
export const SHOP_PAGE_NAMES: Record<ShopPage, string> = {
    [ShopPage.SHELLS]: RESOURCE_META[ResourceId.SHELLS].displayName,
    [ShopPage.TREASURES]: 'Trésors',
    [ShopPage.CORAL]: RESOURCE_META[ResourceId.CORAL].displayName,
};
