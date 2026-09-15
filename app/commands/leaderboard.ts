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
import { LeaderboardSort } from '../idle/leaderboard.ts';
import {
    getLeaderboardView,
    parseLeaderboardPage,
    parseLeaderboardSort,
} from '../idle/leaderboard-view.ts';

const PARAM_PAGE = 'page';
const PARAM_PUBLIC = 'public';
const PARAM_SORT = 'sort';

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
        const sort = parseLeaderboardSort(sortOption);
        const requestedPage = parseLeaderboardPage(pageOption);

        const view = await getLeaderboardView(guild_id, {
            sort,
            page: requestedPage,
            pinnedUserId: requesterId,
        });

        if (view.isEmpty) {
            replyText(res, 'Aucun utilisateur avec des coquillages pour le moment.', {
                ephemeral: !isPublic,
            });
            return;
        }

        replyEmbed(
            res,
            {
                title: '🐚 Classement Coquillages',
                description: view.description,
                color: 0xffd700,
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Page ${view.currentPage}/${view.totalPages} • ${view.totalUsers} utilisateurs • tri : ${view.sort}`,
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
