import { ToolParamType, type Tool, type ToolFunctionDeclaration } from './types.ts';
import {
    getLeaderboardView,
    parseLeaderboardPage,
    parseLeaderboardSort,
} from '../../idle/leaderboard-view.ts';

/** Same content as the `/leaderboard` embed, laid out as one flowing text block for the model. */
export async function formatLeaderboard(
    guildId: string,
    args: { sort?: string; page?: string; user_id?: string },
): Promise<string> {
    const view = await getLeaderboardView(guildId, {
        sort: parseLeaderboardSort(args.sort),
        page: parseLeaderboardPage(Number(args.page)),
        pinnedUserId: args.user_id,
    });

    if (view.isEmpty) {
        return 'Aucun membre avec des coquillages pour le moment sur ce serveur.';
    }

    return `Classement Coquillages — page ${view.currentPage}/${view.totalPages} (${view.totalUsers} membres classés, tri : ${view.sort}) :
${view.description}`;
}

const leaderboardDeclaration: ToolFunctionDeclaration = {
    name: 'get_leaderboard',
    description:
        'Récupère le classement Coquillages du serveur (10 membres par page, comme la commande /leaderboard). Utilise cette fonction pour toute question sur le classement en général : qui est premier, le top des membres, qui a le plus/le moins de coquillages — même formulée informellement ("le classement", "le top", "qui domine"). Pour situer un membre précis dans le classement (même hors de la page affichée), passe son user_id : sa ligne sera incluse en plus, en gras. Pour le profil complet d\'un seul membre (solde, rang, upgrades...), utilise plutôt get_shells_profile.',
    parameters: {
        type: ToolParamType.OBJECT,
        properties: {
            sort: {
                type: ToolParamType.STRING,
                description:
                    'Critère de tri : "max" (record historique, défaut), "current" (solde actuel), ou "income" (gain par message). Omets pour le défaut.',
            },
            page: {
                type: ToolParamType.STRING,
                description: 'Numéro de page (10 membres par page), en chiffres. Défaut : 1.',
            },
            user_id: {
                type: ToolParamType.STRING,
                description:
                    "Identifiant Discord d'un membre à faire apparaître dans la réponse même s'il n'est pas dans les 10 premiers de la page affichée, par exemple pour répondre à \"où en est untel dans le classement\".",
            },
        },
        required: [],
    },
};

export const leaderboardTool: Tool = {
    declaration: leaderboardDeclaration,
    execute: async (args, { guildId }) => {
        try {
            return await formatLeaderboard(guildId, args);
        } catch (error) {
            return `Erreur lors de la récupération du classement: ${(error as Error).message}`;
        }
    },
};
