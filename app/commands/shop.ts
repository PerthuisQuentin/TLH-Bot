import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getUserShellsData, spendUserShells, updateUserShellsPerMessage, DEFAULT_SHELLS_PER_MESSAGE } from '../idle/shells-storage.js';
import { getUserUpgrades, incrementUserUpgrade } from '../idle/upgrades-storage.js';
import { ALL_UPGRADES } from '../idle/upgrades-list.js';
import { getUpgradeCost, getUpgradeGain, getUpgradeTotalCost, getMaxBuyable, formatUpgradeGain } from '../idle/upgrades.js';
import { bn, bnAdd, bnMul, bnCeil, bnFromJSON, bnGte, formatBigNum, type BigNum } from '../commons/big-number.js';
import type { UserUpgrades, UpgradeDefinition } from '../idle/types.js';
import { UpgradeKind } from '../idle/types.js';
import type { Command } from './types.js';

const EPHEMERAL_FLAG = 1 << 6;

function computeShellsPerMessage(userUpgrades: UserUpgrades): BigNum {
    const additive = ALL_UPGRADES
        .filter((u) => u.kind === UpgradeKind.ADDITIVE)
        .reduce((sum, u) => bnAdd(sum, getUpgradeGain(u, upgradeLevel(userUpgrades, u))), bn(DEFAULT_SHELLS_PER_MESSAGE));

    const multiplier = ALL_UPGRADES
        .filter((u) => u.kind === UpgradeKind.MULTIPLICATIVE)
        .reduce((product, u) => bnMul(product, getUpgradeGain(u, upgradeLevel(userUpgrades, u))), bn(1));

    return bnMul(additive, multiplier);
}

function upgradeLevel(upgrades: UserUpgrades, upgrade: UpgradeDefinition): number {
    return (upgrades[upgrade.id as keyof UserUpgrades] as number | undefined) ?? 0;
}

function formatGain(upgrade: UpgradeDefinition, level: number): string {
    return formatUpgradeGain(upgrade, level);
}

function buildUpgradeField(upgrade: UpgradeDefinition, level: number, shells: BigNum) {
    const nextCost = bnCeil(getUpgradeTotalCost(upgrade, level, 1));
    const maxBuyable = getMaxBuyable(upgrade, level, shells);
    const canAfford = bnGte(shells, nextCost);
    const maxCost = bnCeil(getUpgradeTotalCost(upgrade, level, maxBuyable));

    const lines = [
        upgrade.description,
        `> Niveau **${level}** — Gain actuel : **${formatGain(upgrade, level)}**`,
        `> Prochain niveau : **${formatBigNum(nextCost)} 🐚** → **${formatGain(upgrade, level + 1)}**${canAfford ? ` *(max : ${maxBuyable} niveaux pour **${formatBigNum(maxCost)} 🐚**)*` : ' *(fonds insuffisants)*'}`,
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

    if (!guild_id || !userId) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Cette commande ne fonctionne que sur un serveur.',
                flags: EPHEMERAL_FLAG,
            },
        });
        return;
    }

    const options = body.data?.options ?? [];
    const upgradeId = options.find((o) => o.name === 'upgrade')?.value as string | undefined;

    if (upgradeId) {
        await handlePurchase(res, guild_id, userId, upgradeId, options);
    } else {
        handleListing(res, guild_id, userId);
    }
}

function handleListing(res: Response, guildId: string, userId: string): void {
    const shellsData = getUserShellsData(guildId, userId);
    const shells = shellsData ? bnFromJSON(shellsData.shells) : bn(0);
    const userUpgrades = getUserUpgrades(guildId, userId);

    const fields = ALL_UPGRADES.map((upgrade) => {
        const level = upgradeLevel(userUpgrades, upgrade);
        return buildUpgradeField(upgrade, level, shells);
    });

    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            flags: EPHEMERAL_FLAG,
            embeds: [
                {
                    title: '🏪 Boutique',
                    description: `Vous avez **${formatBigNum(shells)} 🐚**\n*Pour acheter, utilisez \`/shop upgrade:… quantite:…\`*`,
                    color: 0x4fc3f7,
                    fields,
                },
            ],
        },
    });
}

async function handlePurchase(
    res: Response,
    guildId: string,
    userId: string,
    upgradeId: string,
    options: Array<{ name: string; value: unknown }>,
): Promise<void> {
    const upgrade = ALL_UPGRADES.find((u) => u.id === upgradeId);
    if (!upgrade) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Upgrade introuvable.', flags: EPHEMERAL_FLAG },
        });
        return;
    }

    const shellsData = getUserShellsData(guildId, userId);
    const shells = shellsData ? bnFromJSON(shellsData.shells) : bn(0);
    const userUpgrades = getUserUpgrades(guildId, userId);
    const currentLevel = upgradeLevel(userUpgrades, upgrade);

    const rawQuantite = options.find((o) => o.name === 'quantity')?.value;
    const quantite = typeof rawQuantite === 'number' ? Math.floor(rawQuantite) : 1;

    const maxBuyable = getMaxBuyable(upgrade, currentLevel, shells);

    if (maxBuyable === 0) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: `Fonds insuffisants. Il vous faut **${formatBigNum(bnCeil(getUpgradeCost(upgrade, currentLevel)))} 🐚** pour le prochain niveau (vous avez **${formatBigNum(shells)} 🐚**).`,
                flags: EPHEMERAL_FLAG,
            },
        });
        return;
    }

    if (quantite > maxBuyable) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: `Vous ne pouvez acheter que **${maxBuyable}** niveau(x) avec vos **${formatBigNum(shells)} 🐚**.`,
                flags: EPHEMERAL_FLAG,
            },
        });
        return;
    }

    const totalCost = bnCeil(getUpgradeTotalCost(upgrade, currentLevel, quantite));
    const spent = spendUserShells(guildId, userId, totalCost);

    if (!spent) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Fonds insuffisants.', flags: EPHEMERAL_FLAG },
        });
        return;
    }

    const newLevel = currentLevel + quantite;
    const updatedUpgrades = incrementUserUpgrade(guildId, userId, upgrade.id as keyof Omit<UserUpgrades, 'userId'>, quantite);
    updateUserShellsPerMessage(guildId, userId, computeShellsPerMessage(updatedUpgrades));

    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            flags: EPHEMERAL_FLAG,
            embeds: [
                {
                    title: '✅ Achat effectué',
                    color: 0x66bb6a,
                    fields: [
                        { name: 'Upgrade', value: upgrade.name, inline: true },
                        { name: 'Niveau', value: `${currentLevel} → **${newLevel}**`, inline: true },
                        { name: 'Coût total', value: `${formatBigNum(totalCost)} 🐚`, inline: true },
                        {
                            name: 'Gain',
                            value: `${formatGain(upgrade, currentLevel)} → **${formatGain(upgrade, newLevel)}**`,
                            inline: true,
                        },
                        { name: 'Solde restant', value: `${formatBigNum(spent.newShells)} 🐚`, inline: true },
                    ],
                },
            ],
        },
    });
}

export const shopCommand: Command = {
    definition: {
        name: 'shop',
        description: 'Affiche la boutique ou achète un upgrade.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
        options: [
            {
                name: 'upgrade',
                description: 'L\'upgrade à acheter',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: ALL_UPGRADES.map((u) => ({ name: u.name, value: u.id })),
            },
            {
                name: 'quantity',
                description: 'Nombre de niveaux à acheter (défaut : 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1,
            },
        ],
    },
    handler: handleShopCommand,
};
