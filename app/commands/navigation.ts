import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord-api-types/v10';
import { actionRow, button } from '../commons/components.ts';
import { componentCustomId } from '../commons/utils.ts';
import { ShopPage } from '../idle/core/types.ts';

/**
 * The row closing `/shells`, `/shop` and `/prestige`: refresh, then one button per panel.
 * The ids are built here rather than imported from each command, which would import one
 * another in a cycle.
 */
export enum NavPanel {
    PROFILE = 'shells',
    SHOP = 'shop',
    PRESTIGE = 'prestige',
}

/** A navigation click redraws the message it lands on as the panel it names. */
export const ACTION_NAVIGATE = 'open';

export function navigateId(panel: NavPanel, shopPage?: ShopPage): string {
    return componentCustomId(panel, shopPage ? `${ACTION_NAVIGATE}:${shopPage}` : ACTION_NAVIGATE);
}

export type NavigationOptions = {
    /** Greyed out: the panel the row sits on. Null on a panel that is not the viewer's own. */
    current: NavPanel | null;
    /** The viewer's, not the profile's: the buttons act on whoever clicks. */
    coralUnlocked: boolean;
    /** The aisle the shop opens on, when the panel points at a particular one. */
    shopPage?: ShopPage;
};

export function navigationRow(
    refreshId: string,
    { current, coralUnlocked, shopPage = ShopPage.SHELLS }: NavigationOptions,
): APIActionRowComponent<APIComponentInMessageActionRow> {
    const entry = (panel: NavPanel, label: string, id = navigateId(panel)) =>
        button(label, id, { disabled: panel === current });
    return actionRow(
        button('🔄', refreshId),
        entry(NavPanel.PROFILE, '👤 Profil'),
        entry(NavPanel.SHOP, '🏪 Boutique', navigateId(NavPanel.SHOP, shopPage)),
        // Hidden while locked, as everywhere else: the 🪸 would announce the reef.
        ...(coralUnlocked ? [entry(NavPanel.PRESTIGE, '🪸 Prestige')] : []),
    );
}
