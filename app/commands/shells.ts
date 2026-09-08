import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { getShellsRolesConfig, nextRoleAfter, roleForShells } from '../idle/shells-roles.ts';
import { bnFromJSON, bnMul, bnSub, formatBigNum } from '../idle/core/big-number.ts';
import {
    getOption,
    isPublicOption,
    replyEmbed,
    replyText,
    requireGuild,
} from '../commons/utils.ts';
import { getAllGameInstances, getGameInstance } from '../idle/game-instance-storage.ts';
import { Leaderboard } from '../idle/leaderboard.ts';
import { ALL_UPGRADE_IDS } from '../idle/core/upgrades/upgrade-registry.ts';
import { ResourceId } from '../idle/core/types.ts';

const PARAM_USER = 'user';
const PARAM_PUBLIC = 'public';

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

        const [instances, instance] = await Promise.all([
            getAllGameInstances(guild_id),
            getGameInstance(guild_id, targetId),
        ]);

        const currentShells = instance.resources[ResourceId.SHELLS];
        const { maxShells } = instance.stats;
        const shellsPerMessage = instance.income[ResourceId.SHELLS];
        const { streak, upgrades } = instance;
        const leaderboard = new Leaderboard(instances);
        const entry = leaderboard.getUserEntry(targetId);

        const rankText = entry ? `#${entry.rank}` : 'Non classé';

        const streakMultiplier = streak.getMultiplier();

        const upgradeLines = ALL_UPGRADE_IDS.map((id) => {
            const upgrade = upgrades[id];
            return `${upgrade.emoji} **${upgrade.name}** — Niv. ${upgrade.level} · ${upgrade.formatGain()}`;
        });

        const shellsRoles = await getShellsRolesConfig(guild_id);
        const currentRole = roleForShells(shellsRoles, maxShells);
        const nextRole = nextRoleAfter(shellsRoles, maxShells);

        const currentRoleText = currentRole ? `<@&${currentRole.roleId}>` : 'Aucun';
        const nextRoleText = nextRole
            ? `<@&${nextRole.roleId}> — encore **${formatBigNum(bnSub(bnFromJSON(nextRole.threshold), maxShells))} 🐚**`
            : '✨ Rang maximum atteint';

        const streakDays = streak.currentValue;
        const streakText =
            streakDays === 0
                ? 'Streak : aucun 🔥'
                : `Streak : ${streakDays} jour${streakDays > 1 ? 's' : ''} 🔥 — ×${streakMultiplier.toFixed(2)}`;

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

        replyEmbed(
            res,
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
            { ephemeral: !isPublic, suppressMentions: true },
        );
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
        integration_types: [
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ],
        contexts: [
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ],
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
