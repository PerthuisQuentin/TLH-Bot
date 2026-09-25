import { RESOURCE_META } from './resources.ts';
import { ResourceId, ShopPage } from './types.ts';

/** How a `/shop` aisle is named where a player sees it: its button, its title, and the texts pointing at it. */
export const SHOP_PAGE_NAMES: Record<ShopPage, string> = {
    [ShopPage.SHELLS]: RESOURCE_META[ResourceId.SHELLS].displayName,
    [ShopPage.TREASURES]: 'Trésors',
    [ShopPage.CORAL]: RESOURCE_META[ResourceId.CORAL].displayName,
};
