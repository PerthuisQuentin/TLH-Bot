import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    ButtonStyle,
    InteractionContextType,
} from 'discord-api-types/v10';
import type {
    APIButtonComponentWithCustomId,
    APIComponentInContainer,
    APIMessageTopLevelComponent,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import {
    ALL_UPGRADE_CLASSES,
    ALL_UPGRADE_IDS,
    UPGRADE_REGISTRY,
} from '../idle/core/upgrades/upgrade-registry.ts';
import { actionRow, button, container, separator, text } from '../commons/components.ts';
import {
    componentCustomId,
    replyComponents,
    replyText,
    requireGuild,
    updateComponents,
} from '../commons/utils.ts';
import {
    getGameInstance,
    updateGameInstance,
    flushGameInstances,
} from '../idle/game-instance-storage.ts';
import { bnCeil } from '../idle/core/big-number.ts';
import type { BigNum } from '../idle/core/big-number.ts';
import { formatResource } from '../idle/core/resources.ts';
import { SHOP_PAGE_NAMES } from '../idle/core/shop-pages.ts';
import type { ReadonlyGameInstance } from '../idle/core/game-instance.ts';
import type { ReadonlyUpgrade } from '../idle/core/upgrades/base-upgrade.ts';
import { ResourceId, ShopPage, UpgradeId } from '../idle/core/types.ts';

const COMMAND_NAME = 'shop';

// `buy:<upgradeId>:<quantity>`, `page:<page>`, `refresh:<page>`, `open:<page>`: the panel keeps
// no state of its own, and a purchase redraws the page its upgrade is sold on.
const ACTION_BUY = 'buy';
const ACTION_PAGE = 'page';
const ACTION_REFRESH = 'refresh';
const ACTION_OPEN = 'open';

const QUANTITY_MAX = 'max';
const QUANTITIES = ['1', '10', QUANTITY_MAX];

const ACCENT_COLOR = 0x4fc3f7;

const PAGE_EMOJIS: Record<ShopPage, string> = {
    [ShopPage.SHELLS]: '🐚',
    [ShopPage.TREASURES]: '💎',
    [ShopPage.CORAL]: '🪸',
};

/**
 * The pages the upgrades declare, derived from the registry so a page nothing is sold on
 * never opens empty. The first page is the default, which keeps shells in front of a player
 * who asks for nothing.
 */
const SHOP_PAGES: ShopPage[] = [...new Set(ALL_UPGRADE_CLASSES.map((c) => c.shopPage))];

type Panel = APIMessageTopLevelComponent[];

/** Opens the shop on `page` in a new private message, for a shortcut drawn by another command. */
export function shopOpenId(page: ShopPage): string {
    return componentCustomId(COMMAND_NAME, `${ACTION_OPEN}:${page}`);
}

function resolvePage(requested: string | undefined): ShopPage {
    return SHOP_PAGES.find((id) => id === requested) ?? SHOP_PAGES[0];
}

function onSale(instance: ReadonlyGameInstance, page: ShopPage): ReadonlyUpgrade[] {
    return ALL_UPGRADE_IDS.filter((id) => instance.isUpgradeVisible(id))
        .map((id) => instance.upgrades[id])
        .filter((upgrade) => upgrade.shopPage === page);
}

// ─── Purchase ────────────────────────────────────────────────────────────────

type PurchaseOutcome =
    | { status: 'locked'; upgrade: ReadonlyUpgrade }
    | { status: 'maxed'; upgrade: ReadonlyUpgrade }
    | { status: 'no-funds'; nextCost: BigNum; balance: BigNum; currency: ResourceId }
    | { status: 'too-many'; maxBuyable: number; balance: BigNum; currency: ResourceId }
    | {
          status: 'bought';
          upgrade: ReadonlyUpgrade;
          previousLevel: number;
          newLevel: number;
          totalCost: BigNum;
          balance: BigNum;
          currency: ResourceId;
      };

/**
 * Check and debit inside the mutator, so a concurrent gain cannot land between the
 * affordability check and the purchase. `max` is resolved there too, on the balance of the
 * moment rather than the one the button was drawn with.
 */
async function purchase(
    guildId: string,
    userId: string,
    upgradeId: UpgradeId,
    quantity: number | typeof QUANTITY_MAX,
): Promise<PurchaseOutcome> {
    const outcome = await updateGameInstance(guildId, userId, (instance): PurchaseOutcome => {
        const upgrade = instance.upgrades[upgradeId];
        const currency = upgrade.costResourceId;
        const balance = instance.resources[currency];

        // Before anything is quoted: naming the price of a hidden upgrade would give away
        // what it is hidden to protect.
        if (!instance.isUpgradeUnlocked(upgradeId)) return { status: 'locked', upgrade };
        if (upgrade.isMaxed) return { status: 'maxed', upgrade };

        const { levels: maxBuyable } = upgrade.getMaxBuyable(balance);
        const levels = quantity === QUANTITY_MAX ? maxBuyable : quantity;

        if (maxBuyable === 0) {
            return { status: 'no-funds', nextCost: bnCeil(upgrade.getCost()), balance, currency };
        }
        if (levels > maxBuyable) {
            return { status: 'too-many', maxBuyable, balance, currency };
        }

        const result = instance.buyUpgrade(upgradeId, levels);
        if (!result) {
            return { status: 'no-funds', nextCost: bnCeil(upgrade.getCost()), balance, currency };
        }
        return {
            status: 'bought',
            upgrade,
            previousLevel: result.previousLevel,
            newLevel: result.newLevel,
            totalCost: result.totalCost,
            balance: instance.resources[currency],
            currency,
        };
    });

    // A purchase is told to the player as done, so it does not ride the write delay.
    if (outcome.status === 'bought') await flushGameInstances(guildId);
    return outcome;
}

function outcomeBanner(outcome: PurchaseOutcome): string {
    switch (outcome.status) {
        case 'locked': {
            const hint = outcome.upgrade.unlockHint;
            return `❌ Cette amélioration n'est pas encore accessible.${hint ? ` ${hint}` : ''}`;
        }
        case 'maxed':
            return `❌ **${outcome.upgrade.name}** est déjà à son niveau maximum.`;
        case 'no-funds':
            return `❌ Fonds insuffisants : il vous faut **${formatResource(outcome.nextCost, outcome.currency)}** pour le prochain niveau (vous avez **${formatResource(outcome.balance, outcome.currency)}**).`;
        case 'too-many':
            return `❌ Vos **${formatResource(outcome.balance, outcome.currency)}** ne couvrent que **${outcome.maxBuyable}** niveau${outcome.maxBuyable > 1 ? 'x' : ''}.`;
        case 'bought': {
            const { upgrade } = outcome;
            return `✅ ${upgrade.emoji} **${upgrade.name}** : niv. ${outcome.previousLevel} → **${outcome.newLevel}** pour **${formatResource(outcome.totalCost, outcome.currency)}** · gain ${upgrade.computeFormatGain(outcome.previousLevel)} → **${upgrade.formatGain()}**`;
        }
    }
}

// ─── Panel ───────────────────────────────────────────────────────────────────

function buyButton(
    upgrade: ReadonlyUpgrade,
    quantity: string,
    label: string,
    disabled: boolean,
): APIButtonComponentWithCustomId {
    return button(
        label,
        componentCustomId(COMMAND_NAME, `${ACTION_BUY}:${upgrade.id}:${quantity}`),
        {
            style: ButtonStyle.Success,
            disabled,
        },
    );
}

/**
 * Prices sit on the buttons, rounded up once where they are both shown and charged. ×10 is
 * greyed out below ten affordable levels rather than silently buying fewer.
 */
function upgradeBlock(
    upgrade: ReadonlyUpgrade,
    instance: ReadonlyGameInstance,
): APIComponentInContainer[] {
    const currency = upgrade.costResourceId;
    const balance = instance.resources[currency];
    const { levels: maxBuyable, totalCost } = upgrade.getMaxBuyable(balance);
    const price = (levels: number) =>
        formatResource(bnCeil(upgrade.getTotalCost(levels)), currency);

    const buttons =
        upgrade.maxLevel === 1
            ? [buyButton(upgrade, '1', `Acheter · ${price(1)}`, maxBuyable < 1)]
            : [
                  buyButton(upgrade, '1', `×1 · ${price(1)}`, maxBuyable < 1),
                  buyButton(upgrade, '10', `×10 · ${price(10)}`, maxBuyable < 10),
                  buyButton(
                      upgrade,
                      QUANTITY_MAX,
                      maxBuyable > 0
                          ? `Max · ${maxBuyable} niv. · ${formatResource(bnCeil(totalCost), currency)}`
                          : 'Max',
                      maxBuyable < 1,
                  ),
              ];

    return [
        text(
            `### ${upgrade.emoji} ${upgrade.name} · niv. ${upgrade.level}\n${upgrade.description}\n` +
                `Gain : **${upgrade.formatGain()}** → **${upgrade.computeFormatGain(upgrade.level + 1)}** au prochain niveau`,
        ),
        actionRow(...buttons),
    ];
}

function shopPanel(instance: ReadonlyGameInstance, page: ShopPage, banner?: string): Panel {
    const upgrades = onSale(instance, page);
    // Every currency the page prices in, so a page mixing them shows each balance.
    const balances = [...new Set(upgrades.map((upgrade) => upgrade.costResourceId))]
        .map((id) => `**${formatResource(instance.resources[id], id)}**`)
        .join(' · ');
    // Reachable once every treasure is bought: the page stays a valid place to land.
    const header =
        upgrades.length > 0 ? `Vous avez ${balances}` : "*Rien à vendre ici pour l'instant.*";

    // An aisle with nothing to sell gets no button, so a locked player is never shown one
    // they cannot enter; the current one stays, greyed out, to say where they are.
    const pageButtons = SHOP_PAGES.filter(
        (id) => id === page || onSale(instance, id).length > 0,
    ).map((id) =>
        button(
            `${PAGE_EMOJIS[id]} ${SHOP_PAGE_NAMES[id]}`,
            componentCustomId(COMMAND_NAME, `${ACTION_PAGE}:${id}`),
            { disabled: id === page },
        ),
    );

    return [
        container(
            ACCENT_COLOR,
            text(`## 🏪 Boutique — ${SHOP_PAGE_NAMES[page]}\n${header}`),
            ...(banner ? [text(banner)] : []),
            separator(),
            ...upgrades.flatMap((upgrade) => upgradeBlock(upgrade, instance)),
            ...(upgrades.length > 0 ? [separator()] : []),
            actionRow(
                ...pageButtons,
                button('🔄', componentCustomId(COMMAND_NAME, `${ACTION_REFRESH}:${page}`)),
            ),
        ),
    ];
}

/** The coral aisle stays shut until the seedling opens it; asking for it lands on the default. */
function landingPage(instance: ReadonlyGameInstance, requested: string | undefined): ShopPage {
    const page = resolvePage(requested);
    return page === ShopPage.CORAL && !instance.coralUnlocked ? SHOP_PAGES[0] : page;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

type Caller = { guildId: string; userId: string };

function resolveCaller(req: Request, res: Response): Caller | undefined {
    const body = req.body as {
        guild_id?: string;
        member?: { user?: { id: string } };
        user?: { id: string };
    };
    const { guild_id } = body;
    const userId = body.member?.user?.id ?? body.user?.id;

    if (!requireGuild(res, guild_id)) return undefined;
    if (!userId) {
        replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
        return undefined;
    }
    return { guildId: guild_id, userId };
}

async function handleShopCommand(req: Request, res: Response): Promise<void> {
    const caller = resolveCaller(req, res);
    if (!caller) return;

    // The reply is the last statement, so reaching the catch means nothing was sent yet.
    try {
        const instance = await getGameInstance(caller.guildId, caller.userId);
        replyComponents(res, shopPanel(instance, SHOP_PAGES[0]), { ephemeral: true });
    } catch (error) {
        console.error('Error handling shop command:', error);
        replyText(res, 'Une erreur est survenue dans la boutique.', { ephemeral: true });
    }
}

/**
 * The shop is always ephemeral, so every click comes from its owner. A purchase acts on the
 * clicker's own instance anyway, whatever the panel was drawn for.
 */
async function handleShopComponent(req: Request, res: Response, action: string): Promise<void> {
    const [kind, arg, rawQuantity] = action.split(':');

    const isPageAction = kind === ACTION_PAGE || kind === ACTION_REFRESH || kind === ACTION_OPEN;
    const isBuy =
        kind === ACTION_BUY &&
        ALL_UPGRADE_IDS.includes(arg as UpgradeId) &&
        QUANTITIES.includes(rawQuantity);
    if (!isPageAction && !isBuy) {
        console.error(`unknown shop action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    const caller = resolveCaller(req, res);
    if (!caller) return;

    try {
        if (isBuy) {
            const upgradeId = arg as UpgradeId;
            const quantity = rawQuantity === QUANTITY_MAX ? QUANTITY_MAX : Number(rawQuantity);
            const outcome = await purchase(caller.guildId, caller.userId, upgradeId, quantity);
            const instance = await getGameInstance(caller.guildId, caller.userId);
            const page = landingPage(instance, UPGRADE_REGISTRY[upgradeId].shopPage);
            updateComponents(res, shopPanel(instance, page, outcomeBanner(outcome)));
            return;
        }

        const instance = await getGameInstance(caller.guildId, caller.userId);
        const panel = shopPanel(instance, landingPage(instance, arg));
        // A shortcut from another command opens a new message and leaves its own in place.
        if (kind === ACTION_OPEN) replyComponents(res, panel, { ephemeral: true });
        else updateComponents(res, panel);
    } catch (error) {
        console.error('Error handling shop click:', error);
        replyText(res, 'Une erreur est survenue dans la boutique.', { ephemeral: true });
    }
}

export const shopCommand: Command = {
    definition: {
        name: COMMAND_NAME,
        description: "Affiche la boutique d'améliorations.",
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    handler: handleShopCommand,
    onComponent: handleShopComponent,
};
