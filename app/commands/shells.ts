import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getUserLeaderboardEntry } from '../idle/shells.js';
import { getShellsPerMessage } from '../idle/shells-storage.js';
import { getRoleForShells, getShellsRolesConfig } from '../idle/shells-roles.js';
import { getUserUpgrades } from '../idle/upgrades-storage.js';
import { ALL_UPGRADES } from '../idle/upgrades-list.js';
import { formatUpgradeGain } from '../idle/upgrades.js';
import { bn, bnSub, bnFromJSON, bnGt, bnMul, formatBigNum, type BigNum } from '../commons/big-number.js';
import type { UserUpgrades } from '../idle/types.js';
import type { Command } from './types.js';

const EPHEMERAL_FLAG = 1 << 6;

function getNextRole(guildId: string, maxShells: BigNum) {
    const roles = getShellsRolesConfig(guildId);
    return roles.find((role) => bnGt(bnFromJSON(role.threshold), maxShells)) ?? null;
}

async function handleShellsCommand(req: Request, res: Response): Promise<void> {
    try {
        const body = req.body as {
            guild_id?: string;
            data?: { options?: Array<{ name: string; value: unknown }> };
            member?: { user?: { id: string } };
            user?: { id: string };
        };
        const { guild_id, data } = body;
        const requesterId = body.member?.user?.id ?? body.user?.id;

        if (!guild_id) {
            res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: 'Cette commande ne fonctionne que sur un serveur.', flags: EPHEMERAL_FLAG },
            });
            return;
        }

        const isPublic = data?.options?.find((opt) => opt.name === 'public')?.value === true;
        const targetId =
            (data?.options?.find((opt) => opt.name === 'user')?.value as string | undefined) ??
            requesterId;

        if (!targetId) {
            res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Impossible de déterminer l'utilisateur cible.", flags: EPHEMERAL_FLAG },
            });
            return;
        }

        const entry = getUserLeaderboardEntry(guild_id, targetId);
        const currentShells = entry?.shells ?? bn(0);
        const maxShells = entry?.maxShells ?? bn(0);
        const rankText = entry ? `#${entry.rank}` : 'Non classé';
        const shellsPerMessage = getShellsPerMessage(guild_id, targetId);
        const userUpgrades = getUserUpgrades(guild_id, targetId);

        const upgradeLines = ALL_UPGRADES.map((u) => {
            const level = (userUpgrades[u.id as keyof UserUpgrades] as number | undefined) ?? 0;
            return `${u.emoji} **${u.name}** — Niv. ${level} · ${formatUpgradeGain(u, level)}`;
        });

        const currentRole = getRoleForShells(guild_id, maxShells);
        const nextRole = getNextRole(guild_id, maxShells);

        const currentRoleText = currentRole ? `<@&${currentRole.roleId}>` : 'Aucun';
        const nextRoleText = nextRole
            ? `<@&${nextRole.roleId}> — encore **${formatBigNum(bnSub(bnFromJSON(nextRole.threshold), maxShells))} 🐚**`
            : '✨ Rang maximum atteint';

        const fields = [
            {
                name: 'Rôles',
                value: `Rang : ${rankText}\nActuel : ${currentRoleText}\nProchain : ${nextRoleText}`,
                inline: false,
            },
            {
                name: 'Coquillages',
                value: `${formatBigNum(currentShells)} 🐚\nPar message : ${formatBigNum(shellsPerMessage)} 🐚 (±10%)\nPar réaction : ${formatBigNum(bnMul(shellsPerMessage, 0.1))} 🐚`,
                inline: false,
            },
            { name: 'Upgrades', value: upgradeLines.join('\n'), inline: false },
        ];

        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                ...(isPublic ? {} : { flags: EPHEMERAL_FLAG }),
                embeds: [
                    {
                        title: '🐚 Profil Coquillages',
                        description: `<@${targetId}>`,
                        color: 0xffd700,
                        fields,
                        timestamp: new Date().toISOString(),
                        ...(!maxShells.eq(currentShells) && {
                            footer: { text: `Max historique : ${formatBigNum(maxShells)} 🐚` },
                        }),
                    },
                ],
                allowed_mentions: { parse: [] },
            },
        });
    } catch (error) {
        console.error('Error handling rank command:', error);
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Une erreur est survenue en récupérant le profil.',
                flags: EPHEMERAL_FLAG,
            },
        });
    }
}

export const shellsCommand: Command = {
    definition: {
        name: 'shells',
        description: "Affiche le profil Coquillages d'un utilisateur",
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
        options: [
            {
                type: ApplicationCommandOptionType.User,
                name: 'user',
                description: 'Utilisateur dont afficher le profil (vous par défaut)',
                required: false,
            },
            {
                type: ApplicationCommandOptionType.Boolean,
                name: 'public',
                description: 'Rendre la réponse visible par tous (par défaut : privée)',
                required: false,
            },
        ],
    },
    handler: handleShellsCommand,
};
