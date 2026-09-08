import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import {
    replyText,
    replyEmbed,
    getOption,
    isPublicOption,
    requireGuild,
} from '../commons/utils.ts';
import type { Command } from './types.ts';
import { Leaderboard, LeaderboardSort, type LeaderboardEntry } from '../idle/leaderboard.ts';
import { getAllGameInstances } from '../idle/game-instance-storage.ts';
import { formatBigNum } from '../idle/core/big-number.ts';

const PARAM_PAGE = 'page';
const PARAM_PUBLIC = 'public';
const PARAM_SORT = 'sort';

function formatUserLine(entry: LeaderboardEntry): string {
    return `#${entry.rank} <@${entry.userId}> — ${formatBigNum(entry.maxShells)} 🐚 *(${formatBigNum(entry.shells)} · +${formatBigNum(entry.shellsPerMessage)}/msg)*`;
}

type FormatLeaderboardParams = {
    entries: LeaderboardEntry[];
    startIndex: number;
    pageSize: number;
    requesterId: string | undefined;
    requesterEntry: LeaderboardEntry | null;
};

function formatLeaderboardDescription({
    entries,
    startIndex,
    pageSize,
    requesterId,
    requesterEntry,
}: FormatLeaderboardParams): string {
    const leaderboardText = entries
        .map((entry) => {
            const line = formatUserLine(entry);
            return requesterId && entry.userId === requesterId ? `**${line}**` : line;
        })
        .join('\n');

    if (!requesterId) return leaderboardText;

    const requesterIsOnPage =
        requesterEntry !== null &&
        requesterEntry.rank > startIndex &&
        requesterEntry.rank <= startIndex + pageSize;

    if (requesterIsOnPage) return leaderboardText;

    if (requesterEntry) {
        return `${leaderboardText}\n—\n**${formatUserLine(requesterEntry)}**`;
    }

    return `${leaderboardText}\n\n—\n**Non classé • <@${requesterId}>**`;
}

async function handleLeaderboardCommand(req: Request, res: Response): Promise<void> {
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
        const pageOption = getOption<number>(data?.options, PARAM_PAGE);
        const sortOption = getOption<string>(data?.options, PARAM_SORT);
        const sort = (Object.values(LeaderboardSort) as string[]).includes(sortOption ?? '')
            ? (sortOption as LeaderboardSort)
            : LeaderboardSort.MAX;
        const requestedPage =
            Number.isInteger(pageOption) && (pageOption as number) > 0 ? (pageOption as number) : 1;

        const instances = await getAllGameInstances(guild_id);
        const leaderboard = new Leaderboard(instances, sort);

        if (leaderboard.totalUsers === 0) {
            replyText(res, 'Aucun utilisateur avec des coquillages pour le moment.', {
                ephemeral: !isPublic,
            });
            return;
        }

        const paginated = leaderboard.getPage(requestedPage);
        const requesterEntry = requesterId ? leaderboard.getUserEntry(requesterId) : null;

        const description = formatLeaderboardDescription({
            entries: paginated.entries,
            startIndex: paginated.startIndex,
            pageSize: paginated.pageSize,
            requesterId,
            requesterEntry,
        });

        replyEmbed(
            res,
            {
                title: '🐚 Classement Coquillages',
                description,
                color: 0xffd700,
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Page ${paginated.currentPage}/${paginated.totalPages} • ${paginated.totalUsers} utilisateurs • tri : ${sort}`,
                },
            },
            { ephemeral: !isPublic, suppressMentions: true },
        );
    } catch (error) {
        console.error('Error handling leaderboard command:', error);
        replyText(res, 'Une erreur est survenue en récupérant le classement.', {
            ephemeral: true,
        });
    }
}

export const leaderboardCommand: Command = {
    definition: {
        name: 'leaderboard',
        description: 'Affiche le classement Coquillages du serveur',
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
                type: ApplicationCommandOptionType.Integer,
                name: PARAM_PAGE,
                description: 'Numéro de page (10 utilisateurs par page)',
                required: false,
                min_value: 1,
            },
            {
                type: ApplicationCommandOptionType.String,
                name: PARAM_SORT,
                description: 'Critère de tri (par défaut : record historique)',
                required: false,
                choices: [
                    { name: 'Record historique', value: LeaderboardSort.MAX },
                    { name: 'Solde actuel', value: LeaderboardSort.CURRENT },
                    { name: 'Revenu par message', value: LeaderboardSort.INCOME },
                ],
            },
            {
                type: ApplicationCommandOptionType.Boolean,
                name: PARAM_PUBLIC,
                description: 'Rendre la réponse visible par tous (par défaut : privée)',
                required: false,
            },
        ],
    },
    handler: handleLeaderboardCommand,
};
