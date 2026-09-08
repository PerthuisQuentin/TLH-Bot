import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { ALL_UPGRADE_IDS, UPGRADE_REGISTRY } from '../idle/core/upgrades/upgrade-registry.ts';
import { getOption, replyEmbed, replyText, requireGuild } from '../commons/utils.ts';
import {
    getGameInstance,
    updateGameInstance,
    flushGameInstances,
} from '../idle/game-instance-storage.ts';
import { BigNum, bnCeil, formatBigNum } from '../idle/core/big-number.ts';
import type { ReadonlyUpgrade } from '../idle/core/upgrades/base-upgrade.ts';
import { ResourceId, UpgradeId } from '../idle/core/types.ts';

const PARAM_UPGRADE = 'upgrade';
const PARAM_QUANTITY = 'quantity';

function buildUpgradeField(
    upgrade: ReadonlyUpgrade,
    resources: Record<ResourceId, BigNum>,
): { name: string; value: string; inline: boolean } {
    const nextCost = bnCeil(upgrade.getCost());
    const { levels: maxBuyable, totalCost } = upgrade.getMaxBuyable(
        resources[upgrade.costResourceId],
    );
    const maxCost = bnCeil(totalCost);
    // Derived from maxBuyable rather than compared to nextCost, so the price and the
    // "max" hint can never contradict each other.
    const canAfford = maxBuyable > 0;

    const lines = [
        upgrade.description,
        `> Niveau **${upgrade.level}** — Gain actuel : **${upgrade.formatGain()}**`,
        `> Prochain niveau : **${formatBigNum(nextCost)} 🐚** → **${upgrade.computeFormatGain(upgrade.level + 1)}**${canAfford ? ` *(max : ${maxBuyable} niveaux pour **${formatBigNum(maxCost)} 🐚**)*` : ' *(fonds insuffisants)*'}`,
    ];

    return {
        name: `${upgrade.emoji} ${upgrade.name}`,
        value: lines.join('\n'),
        inline: false,
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

    // Both branches reply as their last statement, so reaching the catch means
    // nothing was sent yet and the error reply is always the only one.
    try {
        if (upgradeId) {
            await handlePurchase(res, guild_id, userId, upgradeId, options);
        } else {
            await handleListing(res, guild_id, userId);
        }
    } catch (error) {
        console.error('Error handling shop command:', error);
        replyText(res, 'Une erreur est survenue dans la boutique.', { ephemeral: true });
    }
}

async function handleListing(res: Response, guildId: string, userId: string): Promise<void> {
    const instance = await getGameInstance(guildId, userId);

    const resources = instance.resources;
    const fields = ALL_UPGRADE_IDS.map((upgradeId) => {
        const upgrade = instance.upgrades[upgradeId];
        return buildUpgradeField(upgrade, resources);
    });

    replyEmbed(
        res,
        {
            title: '🏪 Boutique',
            description: `Vous avez **${formatBigNum(resources[ResourceId.SHELLS])} 🐚**\n*Pour acheter, utilisez \`/shop ${PARAM_UPGRADE}:… ${PARAM_QUANTITY}:…\`*`,
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
        const shells = instance.resources[upgrade.costResourceId];
        const { levels: maxBuyable } = upgrade.getMaxBuyable(shells);

        if (maxBuyable === 0) {
            return { status: 'no-funds' as const, nextCost: bnCeil(upgrade.getCost()), shells };
        }
        if (quantity > maxBuyable) {
            return { status: 'too-many' as const, maxBuyable, shells };
        }

        const result = instance.buyUpgrade(upgradeId as UpgradeId, quantity);
        if (!result) {
            return { status: 'no-funds' as const, nextCost: bnCeil(upgrade.getCost()), shells };
        }

        return {
            status: 'bought' as const,
            result,
            upgrade,
            shells: instance.resources[upgrade.costResourceId],
        };
    });

    if (outcome.status === 'no-funds') {
        replyText(
            res,
            `Fonds insuffisants. Il vous faut **${formatBigNum(outcome.nextCost)} 🐚** pour le prochain niveau (vous avez **${formatBigNum(outcome.shells)} 🐚**).`,
            { ephemeral: true },
        );
        return;
    }

    if (outcome.status === 'too-many') {
        replyText(
            res,
            `Vous ne pouvez acheter que **${outcome.maxBuyable}** niveau(x) avec vos **${formatBigNum(outcome.shells)} 🐚**.`,
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
                { name: 'Coût total', value: `${formatBigNum(result.totalCost)} 🐚`, inline: true },
                {
                    name: 'Gain',
                    value: `${upgrade.computeFormatGain(result.previousLevel)} → **${upgrade.formatGain()}**`,
                    inline: true,
                },
                {
                    name: 'Solde restant',
                    value: `${formatBigNum(outcome.shells)} 🐚`,
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
