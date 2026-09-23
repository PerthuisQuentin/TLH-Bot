import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import {
    ALL_UPGRADE_CLASSES,
    ALL_UPGRADE_IDS,
    UPGRADE_REGISTRY,
} from '../idle/core/upgrades/upgrade-registry.ts';
import { getOption, replyEmbed, replyText, requireGuild } from '../commons/utils.ts';
import {
    getGameInstance,
    updateGameInstance,
    flushGameInstances,
} from '../idle/game-instance-storage.ts';
import { BigNum, bnCeil } from '../idle/core/big-number.ts';
import { formatResource } from '../idle/core/resources.ts';
import { SHOP_PAGE_NAMES } from '../idle/core/shop-pages.ts';
import type { ReadonlyUpgrade } from '../idle/core/upgrades/base-upgrade.ts';
import { ResourceId, ShopPage, UpgradeId } from '../idle/core/types.ts';

const PARAM_UPGRADE = 'upgrade';
const PARAM_QUANTITY = 'quantity';
const PARAM_PAGE = 'page';

/**
 * The pages the upgrades declare, derived from the registry so a page nothing is sold on
 * never opens empty. The first page is the default, which keeps shells in front of a player
 * who asks for nothing.
 */
const SHOP_PAGES: ShopPage[] = [...new Set(ALL_UPGRADE_CLASSES.map((c) => c.shopPage))];

function resolvePage(requested: string | undefined): ShopPage {
    return SHOP_PAGES.find((id) => id === requested) ?? SHOP_PAGES[0];
}

function buildUpgradeField(
    upgrade: ReadonlyUpgrade,
    resources: Record<ResourceId, BigNum>,
): { name: string; value: string; inline: boolean } {
    const currency = upgrade.costResourceId;
    const nextCost = bnCeil(upgrade.getCost());
    const { levels: maxBuyable, totalCost } = upgrade.getMaxBuyable(resources[currency]);
    const maxCost = bnCeil(totalCost);
    // Derived from maxBuyable rather than compared to nextCost, so the price and the
    // "max" hint can never contradict each other.
    const canAfford = maxBuyable > 0;

    // Only visible upgrades get a field, and a visible one always has a next level.
    const secondLine = `> Prochain niveau : **${formatResource(nextCost, currency)}** → **${upgrade.computeFormatGain(upgrade.level + 1)}**${canAfford ? ` *(max : ${maxBuyable} niveau${maxBuyable > 1 ? 'x' : ''} pour **${formatResource(maxCost, currency)}**)*` : ' *(fonds insuffisants)*'}`;

    const lines = [
        upgrade.description,
        `> Niveau **${upgrade.level}** — Gain actuel : **${upgrade.formatGain()}**`,
        secondLine,
    ];

    return {
        name: `${upgrade.emoji} ${upgrade.name}`,
        value: lines.join('\n'),
        inline: false,
    };
}

/** The aisle a locked player sees instead of the coral one: a door, not an inventory. */
function lockedCoralEmbed(): Parameters<typeof replyEmbed>[1] {
    const seedling = UPGRADE_REGISTRY[UpgradeId.CORAL_SEEDLING];
    return {
        title: `🏪 Boutique — ${SHOP_PAGE_NAMES[ShopPage.CORAL]}`,
        description:
            `Ce rayon est encore fermé.\n\n` +
            `Il vous faut ${seedling.emoji} **${seedling.displayName}**, en vente dans ` +
            `\`/shop ${PARAM_PAGE}:${SHOP_PAGE_NAMES[seedling.shopPage]}\`, pour l'ouvrir.`,
        color: 0x4fc3f7,
    };
}

async function handleShopCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as {
        guild_id?: string;
        member?: { user?: { id: string } };
        user?: { id: string };
        data?: { options?: Array<{ name: string; value: unknown }> };
    };

    const { guild_id } = body;
    const userId = body.member?.user?.id ?? body.user?.id;

    if (!requireGuild(res, guild_id)) return;
    if (!userId) {
        replyText(res, 'Impossible de déterminer l\u2019utilisateur.', { ephemeral: true });
        return;
    }

    const options = body.data?.options ?? [];
    const upgradeId = getOption<string>(options, PARAM_UPGRADE);
    const page = resolvePage(getOption<string>(options, PARAM_PAGE));

    // Both branches reply as their last statement, so reaching the catch means
    // nothing was sent yet and the error reply is always the only one.
    try {
        if (upgradeId) {
            await handlePurchase(res, guild_id, userId, upgradeId, options);
        } else {
            await handleListing(res, guild_id, userId, page);
        }
    } catch (error) {
        console.error('Error handling shop command:', error);
        replyText(res, 'Une erreur est survenue dans la boutique.', { ephemeral: true });
    }
}

async function handleListing(
    res: Response,
    guildId: string,
    userId: string,
    page: ShopPage,
): Promise<void> {
    const instance = await getGameInstance(guildId, userId);

    if (page === ShopPage.CORAL && !instance.coralUnlocked) {
        replyEmbed(res, lockedCoralEmbed(), { ephemeral: true });
        return;
    }

    const resources = instance.resources;
    const onSale = (shopPage: ShopPage) =>
        ALL_UPGRADE_IDS.filter((id) => instance.isUpgradeVisible(id))
            .map((id) => instance.upgrades[id])
            .filter((upgrade) => upgrade.shopPage === shopPage);

    const pageUpgrades = onSale(page);
    // Every currency the page prices in, so a page mixing them shows each balance.
    const balances = [...new Set(pageUpgrades.map((upgrade) => upgrade.costResourceId))]
        .map((id) => `**${formatResource(resources[id], id)}**`)
        .join(' · ');

    const fields = pageUpgrades.map((upgrade) => buildUpgradeField(upgrade, resources));

    // An aisle with nothing to show is not advertised, so a locked player is never pointed
    // at a currency they have no idea about.
    const others = SHOP_PAGES.filter((id) => id !== page && onSale(id).length > 0).map(
        (id) => `\`/shop ${PARAM_PAGE}:${SHOP_PAGE_NAMES[id]}\``,
    );
    const otherPages = others.length > 0 ? `\n*Autres rayons : ${others.join(' · ')}*` : '';
    // Reachable once every treasure is bought: the page stays a valid choice for everyone.
    const header =
        pageUpgrades.length > 0
            ? `Vous avez ${balances}\n*Pour acheter, utilisez \`/shop ${PARAM_UPGRADE}:… ${PARAM_QUANTITY}:…\`*`
            : "*Rien à vendre ici pour l'instant.*";

    replyEmbed(
        res,
        {
            title: `🏪 Boutique — ${SHOP_PAGE_NAMES[page]}`,
            description: `${header}${otherPages}`,
            color: 0x4fc3f7,
            fields,
        },
        { ephemeral: true },
    );
}

async function handlePurchase(
    res: Response,
    guildId: string,
    userId: string,
    upgradeId: string,
    options: Array<{ name: string; value: unknown }>,
): Promise<void> {
    const exist = ALL_UPGRADE_IDS.includes(upgradeId as UpgradeId);
    if (!exist) {
        replyText(res, 'Amélioration introuvable.', { ephemeral: true });
        return;
    }

    const rawQuantity = getOption<number>(options, PARAM_QUANTITY);
    const quantity = typeof rawQuantity === 'number' ? Math.floor(rawQuantity) : 1;
    // Discord already enforces min_value: 1, so this only catches a malformed payload
    // before it reaches buyUpgrade, which throws on anything but a positive integer.
    if (!Number.isInteger(quantity) || quantity < 1) {
        replyText(res, 'La quantité doit être un nombre entier positif.', { ephemeral: true });
        return;
    }

    // Check and debit inside the mutator, so a concurrent gain cannot land between
    // the affordability check and the purchase.
    const outcome = await updateGameInstance(guildId, userId, (instance) => {
        const upgrade = instance.upgrades[upgradeId as UpgradeId];
        const currency = upgrade.costResourceId;
        const balance = instance.resources[currency];

        // Before anything is quoted: naming the price of a hidden upgrade would give away
        // what it is hidden to protect, the coral currency for one.
        if (!instance.isUpgradeUnlocked(upgradeId as UpgradeId)) {
            return { status: 'locked' as const, upgrade };
        }
        if (upgrade.isMaxed) {
            return { status: 'maxed' as const, upgrade };
        }

        const { levels: maxBuyable } = upgrade.getMaxBuyable(balance);

        if (maxBuyable === 0) {
            const nextCost = bnCeil(upgrade.getCost());
            return { status: 'no-funds' as const, nextCost, balance, currency };
        }
        if (quantity > maxBuyable) {
            return { status: 'too-many' as const, maxBuyable, balance, currency };
        }

        const result = instance.buyUpgrade(upgradeId as UpgradeId, quantity);
        if (!result) {
            const nextCost = bnCeil(upgrade.getCost());
            return { status: 'no-funds' as const, nextCost, balance, currency };
        }

        return {
            status: 'bought' as const,
            result,
            upgrade,
            balance: instance.resources[currency],
            currency,
        };
    });

    if (outcome.status === 'locked') {
        const hint = outcome.upgrade.unlockHint;
        replyText(res, `Cette amélioration n'est pas encore accessible.${hint ? ` ${hint}` : ''}`, {
            ephemeral: true,
        });
        return;
    }

    if (outcome.status === 'maxed') {
        replyText(res, `**${outcome.upgrade.name}** est déjà à son niveau maximum.`, {
            ephemeral: true,
        });
        return;
    }

    if (outcome.status === 'no-funds') {
        replyText(
            res,
            `Fonds insuffisants. Il vous faut **${formatResource(outcome.nextCost, outcome.currency)}** pour le prochain niveau (vous avez **${formatResource(outcome.balance, outcome.currency)}**).`,
            { ephemeral: true },
        );
        return;
    }

    if (outcome.status === 'too-many') {
        replyText(
            res,
            `Vous ne pouvez acheter que **${outcome.maxBuyable}** niveau(x) avec vos **${formatResource(outcome.balance, outcome.currency)}**.`,
            { ephemeral: true },
        );
        return;
    }

    const { result, upgrade } = outcome;

    // A purchase is told to the player as done, so it does not ride the write delay.
    await flushGameInstances(guildId);

    replyEmbed(
        res,
        {
            title: '✅ Achat effectué',
            color: 0x66bb6a,
            fields: [
                { name: 'Amélioration', value: upgrade.name, inline: true },
                {
                    name: 'Niveau',
                    value: `${result.previousLevel} → **${result.newLevel}**`,
                    inline: true,
                },
                {
                    name: 'Coût total',
                    value: formatResource(result.totalCost, outcome.currency),
                    inline: true,
                },
                {
                    name: 'Gain',
                    value: `${upgrade.computeFormatGain(result.previousLevel)} → **${upgrade.formatGain()}**`,
                    inline: true,
                },
                {
                    name: 'Solde restant',
                    value: formatResource(outcome.balance, outcome.currency),
                    inline: true,
                },
            ],
        },
        { ephemeral: true },
    );
}

export const shopCommand: Command = {
    definition: {
        name: 'shop',
        description: "Affiche la boutique d'améliorations.",
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
        options: [
            {
                name: PARAM_UPGRADE,
                description: "L'amélioration à acheter",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: ALL_UPGRADE_IDS.map((id) => ({
                    name: UPGRADE_REGISTRY[id].displayName,
                    value: id,
                })),
            },
            {
                name: PARAM_PAGE,
                description: 'Le rayon à afficher (défaut : Coquillages)',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: SHOP_PAGES.map((id) => ({
                    name: SHOP_PAGE_NAMES[id],
                    value: id,
                })),
            },
            {
                name: PARAM_QUANTITY,
                description: 'Nombre de niveaux à acheter (défaut : 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1,
            },
        ],
    },
    handler: handleShopCommand,
};
