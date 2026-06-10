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
import { replyText, replyEmbed, getOption, requireGuild } from '../commons/utils.js';
import type { UserUpgrades, UpgradeDefinition } from '../idle/types.js';
import { UpgradeKind } from '../idle/types.js';
import type { Command } from './types.js';

const PARAM_UPGRADE = 'upgrade';
const PARAM_QUANTITY = 'quantity';

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

    if (!requireGuild(res, guild_id)) return;
    if (!userId) {
        replyText(res, 'Impossible de déterminer l\u2019utilisateur.', { ephemeral: true });
        return;
    }

    const options = body.data?.options ?? [];
    const upgradeId = getOption<string>(options, PARAM_UPGRADE);

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

    replyEmbed(res, {
        title: '🏪 Boutique',
        description: `Vous avez **${formatBigNum(shells)} 🐚**\n*Pour acheter, utilisez \`/shop ${PARAM_UPGRADE}:… ${PARAM_QUANTITY}:…\`*`,
        color: 0x4fc3f7,
        fields,
    }, { ephemeral: true });
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
        replyText(res, 'Amélioration introuvable.', { ephemeral: true });
        return;
    }

    const shellsData = getUserShellsData(guildId, userId);
    const shells = shellsData ? bnFromJSON(shellsData.shells) : bn(0);
    const userUpgrades = getUserUpgrades(guildId, userId);
    const currentLevel = upgradeLevel(userUpgrades, upgrade);

    const rawQuantite = getOption<number>(options, PARAM_QUANTITY);
    const quantite = typeof rawQuantite === 'number' ? Math.floor(rawQuantite) : 1;

    const maxBuyable = getMaxBuyable(upgrade, currentLevel, shells);

    if (maxBuyable === 0) {
        replyText(res, `Fonds insuffisants. Il vous faut **${formatBigNum(bnCeil(getUpgradeCost(upgrade, currentLevel)))} 🐚** pour le prochain niveau (vous avez **${formatBigNum(shells)} 🐚**).`, { ephemeral: true });
        return;
    }

    if (quantite > maxBuyable) {
        replyText(res, `Vous ne pouvez acheter que **${maxBuyable}** niveau(x) avec vos **${formatBigNum(shells)} 🐚**.`, { ephemeral: true });
        return;
    }

    const totalCost = bnCeil(getUpgradeTotalCost(upgrade, currentLevel, quantite));
    const spent = spendUserShells(guildId, userId, totalCost);

    if (!spent) {
        replyText(res, 'Fonds insuffisants.', { ephemeral: true });
        return;
    }

    const newLevel = currentLevel + quantite;
    const updatedUpgrades = incrementUserUpgrade(guildId, userId, upgrade.id as keyof Omit<UserUpgrades, 'userId'>, quantite);
    updateUserShellsPerMessage(guildId, userId, computeShellsPerMessage(updatedUpgrades));

    replyEmbed(res, {
        title: '✅ Achat effectué',
        color: 0x66bb6a,
        fields: [
            { name: 'Amélioration', value: upgrade.name, inline: true },
            { name: 'Niveau', value: `${currentLevel} → **${newLevel}**`, inline: true },
            { name: 'Coût total', value: `${formatBigNum(totalCost)} 🐚`, inline: true },
            {
                name: 'Gain',
                value: `${formatGain(upgrade, currentLevel)} → **${formatGain(upgrade, newLevel)}**`,
                inline: true,
            },
            { name: 'Solde restant', value: `${formatBigNum(spent.newShells)} 🐚`, inline: true },
        ],
    }, { ephemeral: true });
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
                choices: ALL_UPGRADES.map((u) => ({ name: u.name, value: u.id })),
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
