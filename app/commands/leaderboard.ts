import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import {
    getPaginatedShellsLeaderboard,
    getUserLeaderboardEntry,
    getUserShells,
} from '../idle/shells.js';
import type { ShellsUser, LeaderboardEntry } from '../idle/types.js';
import type { Command } from './types.js';

interface FormatLeaderboardParams {
    pageUsers: ShellsUser[];
    startIndex: number;
    pageSize: number;
    requesterId: string | undefined;
    requesterEntry: LeaderboardEntry | null;
    requesterShells: number;
}

function formatLeaderboardDescription({
    pageUsers,
    startIndex,
    pageSize,
    requesterId,
    requesterEntry,
    requesterShells,
}: FormatLeaderboardParams): string {
    const leaderboardText = pageUsers
        .map((user, index) => {
            const rank = startIndex + index + 1;
            const line = `#${rank} <@${user.userId}> - ${user.shells} 🐚`;
            if (requesterId && user.userId === requesterId) {
                return `**${line}**`;
            }
            return line;
        })
        .join('\n');

    if (!requesterId) return leaderboardText;

    const requesterIsOnPage =
        requesterEntry &&
        requesterEntry.rank > startIndex &&
        requesterEntry.rank <= startIndex + pageSize;

    if (requesterIsOnPage) return leaderboardText;

    if (requesterEntry) {
        return `${leaderboardText}\n—\n**#${requesterEntry.rank} <@${requesterId}> - ${requesterEntry.shells} 🐚**`;
    }

    return `${leaderboardText}\n\n—\n**Non classé • <@${requesterId}> - ${requesterShells} 🐚**`;
}

async function handleLeaderboardCommand(
    req: Request,
    res: Response,
): Promise<void> {
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

        const pageOption = data?.options?.find((opt) => opt.name === 'page')?.value;
        const requestedPage =
            Number.isInteger(pageOption) && (pageOption as number) > 0
                ? (pageOption as number)
                : 1;

        const paginated = getPaginatedShellsLeaderboard(guild_id, requestedPage, 10);

        if (paginated.totalUsers === 0) {
            res.send({
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: 'Aucun utilisateur avec des coquillages pour le moment.',
                },
            });
            return;
        }

        const pageUsers = paginated.users;
        const startIndex = paginated.startIndex;
        const currentPage = paginated.currentPage;
        const totalPages = paginated.totalPages;
        const requesterEntry = requesterId
            ? getUserLeaderboardEntry(guild_id, requesterId)
            : null;
        const requesterShells = requesterId ? getUserShells(guild_id, requesterId) : 0;

        const description = formatLeaderboardDescription({
            pageUsers,
            startIndex,
            pageSize: paginated.pageSize,
            requesterId,
            requesterEntry,
            requesterShells,
        });

        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                embeds: [
                    {
                        title: '🐚 Classement Coquillages',
                        description,
                        color: 0xffd700,
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: `Page ${currentPage}/${totalPages} • ${paginated.totalUsers} utilisateurs`,
                        },
                    },
                ],
                allowed_mentions: { parse: [] },
            },
        });
    } catch (error) {
        console.error('Error handling leaderboard command:', error);
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Une erreur est survenue en récupérant le classement.',
            },
        });
    }
}

export const leaderboardCommand: Command = {
    definition: {
        name: 'leaderboard',
        description: 'Affiche le classement Coquillages du serveur',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
        options: [
            {
                type: ApplicationCommandOptionType.Integer,
                name: 'page',
                description: 'Numéro de page (10 utilisateurs par page)',
                required: false,
                min_value: 1,
            },
        ],
    },
    handler: handleLeaderboardCommand,
};
