import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getUserLeaderboardEntry } from '../idle/shells.js';
import { getRoleForShells, getShellsRolesConfig } from '../idle/shells-roles.js';
import type { Command } from './types.js';

function getNextRole(guildId: string, maxShells: number) {
    const roles = getShellsRolesConfig(guildId);
    return roles.find((role) => role.threshold > maxShells) ?? null;
}

async function handleRankCommand(req: Request, res: Response): Promise<void> {
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
                data: { content: 'Cette commande ne fonctionne que sur un serveur.' },
            });
            return;
        }

        const targetId =
            (data?.options?.find((opt) => opt.name === 'utilisateur')?.value as string | undefined) ??
            requesterId;

        if (!targetId) {
            res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Impossible de déterminer l'utilisateur cible." },
            });
            return;
        }

        const entry = getUserLeaderboardEntry(guild_id, targetId);
        const currentShells = entry?.shells ?? 0;
        const maxShells = entry?.maxShells ?? 0;
        const rankText = entry ? `#${entry.rank}` : 'Non classé';

        const currentRole = getRoleForShells(guild_id, maxShells);
        const nextRole = getNextRole(guild_id, maxShells);

        const currentRoleText = currentRole ? `<@&${currentRole.roleId}>` : 'Aucun';
        const nextRoleText = nextRole
            ? `<@&${nextRole.roleId}> — encore **${nextRole.threshold - maxShells} 🐚**`
            : '✨ Rang maximum atteint';

        const fields = [
            { name: 'Rang', value: rankText, inline: true },
            { name: 'Coquillages', value: `${currentShells} 🐚`, inline: true },
            { name: 'Rôle actuel', value: currentRoleText, inline: true },
            { name: 'Prochain rôle', value: nextRoleText, inline: false },
        ];

        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [
                    {
                        title: '🐚 Profil Coquillages',
                        description: `<@${targetId}>`,
                        color: 0xffd700,
                        fields,
                        timestamp: new Date().toISOString(),
                        ...(maxShells !== currentShells && {
                            footer: { text: `Max historique : ${maxShells} 🐚` },
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
            },
        });
    }
}

export const rankCommand: Command = {
    definition: {
        name: 'rank',
        description: "Affiche le profil Coquillages d'un utilisateur",
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
        options: [
            {
                type: ApplicationCommandOptionType.User,
                name: 'utilisateur',
                description: 'Utilisateur dont afficher le profil (vous par défaut)',
                required: false,
            },
        ],
    },
    handler: handleRankCommand,
};
