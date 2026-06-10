import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getUserLeaderboardEntry } from '../idle/shells.js';
import { getShellsPerMessage, getUserShellsData } from '../idle/shells-storage.js';
import { getStreakMultiplier } from '../idle/streak.js';
import { getRoleForShells, getShellsRolesConfig } from '../idle/shells-roles.js';
import { getUserUpgrades } from '../idle/upgrades-storage.js';
import { ALL_UPGRADES } from '../idle/upgrades-list.js';
import { formatUpgradeGain } from '../idle/upgrades.js';
import { bn, bnSub, bnFromJSON, bnGt, bnMul, formatBigNum, type BigNum } from '../commons/big-number.js';
import { replyText, replyEmbed, getOption, isPublicOption, requireGuild } from '../commons/utils.js';
import type { UserUpgrades } from '../idle/types.js';
import type { Command } from './types.js';

const PARAM_USER = 'utilisateur';
const PARAM_PUBLIC = 'public';

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

        if (!requireGuild(res, guild_id)) return;

        const isPublic = isPublicOption(data?.options);
        const targetId = getOption<string>(data?.options, PARAM_USER) ?? requesterId;

        if (!targetId) {
            replyText(res, "Impossible de déterminer l'utilisateur cible.", { ephemeral: true });
            return;
        }

        const entry = getUserLeaderboardEntry(guild_id, targetId);
        const currentShells = entry?.shells ?? bn(0);
        const maxShells = entry?.maxShells ?? bn(0);
        const rankText = entry ? `#${entry.rank}` : 'Non classé';
        const shellsPerMessage = getShellsPerMessage(guild_id, targetId);
        const userUpgrades = getUserUpgrades(guild_id, targetId);

        const userData = getUserShellsData(guild_id, targetId);
        const streak = userData?.streak ?? 0;
        const streakMultiplier = getStreakMultiplier(Math.max(streak, 1));

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

        const streakText = streak === 0
            ? 'Streak : aucun 🔥'
            : `Streak : ${streak} jour${streak > 1 ? 's' : ''} 🔥 — ×${streakMultiplier.toFixed(2)}`;

        const fields = [
            {
                name: 'Rôles',
                value: `Rang : ${rankText}\nActuel : ${currentRoleText}\nProchain : ${nextRoleText}`,
                inline: false,
            },
            {
                name: 'Coquillages',
                value: `${formatBigNum(currentShells)} 🐚\nPar message : ${formatBigNum(shellsPerMessage)} 🐚 (±10%)\nPar réaction : ${formatBigNum(bnMul(shellsPerMessage, 0.1))} 🐚\n${streakText}`,
                inline: false,
            },
            { name: 'Upgrades', value: upgradeLines.join('\n'), inline: false },
        ];

        replyEmbed(res, {
            title: '🐚 Profil Coquillages',
            description: `<@${targetId}>`,
            color: 0xffd700,
            fields,
            timestamp: new Date().toISOString(),
            ...(!maxShells.eq(currentShells) && {
                footer: { text: `Max historique : ${formatBigNum(maxShells)} 🐚` },
            }),
        }, { ephemeral: !isPublic, suppressMentions: true });
    } catch (error) {
        console.error('Error handling rank command:', error);
        replyText(res, 'Une erreur est survenue en récupérant le profil.', { ephemeral: true });
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
                name: PARAM_USER,
                description: 'Utilisateur dont afficher le profil (vous par défaut)',
                required: false,
            },
            {
                type: ApplicationCommandOptionType.Boolean,
                name: PARAM_PUBLIC,
                description: 'Rendre la réponse visible par tous (par défaut : privée)',
                required: false,
            },
        ],
    },
    handler: handleShellsCommand,
};
