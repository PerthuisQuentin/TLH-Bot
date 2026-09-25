import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    ComponentType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type {
    APIButtonComponentWithCustomId,
    APIMessageTopLevelComponent,
} from 'discord-api-types/v10';
import {
    componentCustomId,
    replyComponents,
    replyText,
    requireGuild,
    updateComponents,
} from '../commons/utils.ts';
import type { Command } from './types.ts';
import {
    actionRow,
    button,
    container,
    separator,
    shareFooter,
    text,
} from '../commons/components.ts';
import { LeaderboardSort } from '../idle/leaderboard.ts';
import {
    getLeaderboardView,
    parseLeaderboardPage,
    parseLeaderboardSort,
} from '../idle/leaderboard-view.ts';

const COMMAND_NAME = 'leaderboard';

// Button actions carry the page they lead to, as `<action>:<sort>:<page>`: the message keeps
// no state of its own. Each button has its own action, so custom_ids never collide even when
// several lead to the same page.
const ACTION_FIRST = 'first';
const ACTION_PREV = 'prev';
const ACTION_PAGE = 'page';
const ACTION_NEXT = 'next';
const ACTION_LAST = 'last';
const PAGE_ACTIONS = [ACTION_FIRST, ACTION_PREV, ACTION_PAGE, ACTION_NEXT, ACTION_LAST];
const ACTION_SORT = 'sort';
const ACTION_SHARE = 'share';

const ACCENT_COLOR = 0xffd700;

// Worded as titles: the closed select heads the panel and names the ranking shown. The
// rings keep the 🌀 they carry everywhere else, `/shells` and the ranked lines included.
const SORT_OPTIONS: Record<LeaderboardSort, { label: string; emoji: string }> = {
    [LeaderboardSort.MAX]: { label: 'Classement par record historique', emoji: '🏆' },
    [LeaderboardSort.CURRENT]: { label: 'Classement par solde actuel', emoji: '🐚' },
    [LeaderboardSort.INCOME]: { label: 'Classement par revenu par message', emoji: '💬' },
    [LeaderboardSort.RINGS]: { label: 'Classement par stries de croissance', emoji: '🌀' },
};

type Panel = APIMessageTopLevelComponent[];

type InteractionBody = {
    guild_id?: string;
    member?: { user?: { id: string } };
    user?: { id: string };
    data?: { values?: string[] };
};

function pageButton(
    label: string,
    action: string,
    sort: LeaderboardSort,
    page: number,
    disabled: boolean,
): APIButtonComponentWithCustomId {
    return button(label, componentCustomId(COMMAND_NAME, `${action}:${sort}:${page}`), {
        disabled,
    });
}

/** The page is recomputed on every render, so a click always shows the ranking as it is now. */
async function leaderboardPanel(
    guildId: string,
    sort: LeaderboardSort,
    page: number,
    viewerId: string | undefined,
    sharedBy?: string,
): Promise<Panel> {
    const view = await getLeaderboardView(guildId, { sort, page, pinnedUserId: viewerId });

    if (view.isEmpty) {
        return [
            container(ACCENT_COLOR, text('Aucun utilisateur avec des coquillages pour le moment.')),
        ];
    }

    const { currentPage, totalPages } = view;
    const onFirst = currentPage <= 1;
    const onLast = currentPage >= totalPages;
    const updatedAt = `<t:${Math.floor(Date.now() / 1000)}:R>`;
    const stats = `${view.totalUsers} utilisateurs · mis à jour ${updatedAt}`;

    // A shared ranking is a read-only snapshot: no component, so a click can only ever come
    // from a private panel, whose clicker is its author.
    if (sharedBy) {
        const { emoji, label } = SORT_OPTIONS[sort];
        return [
            container(
                ACCENT_COLOR,
                text(`## ${emoji} ${label}\n${view.description}`),
                separator(),
                text(
                    `-# Page ${currentPage}/${totalPages} · ${stats} · partagé par <@${sharedBy}>`,
                ),
            ),
        ];
    }

    return [
        // The sort select doubles as the title, right on top of what it orders; the arrows
        // sit at the bottom so nothing comes between the two.
        container(
            ACCENT_COLOR,
            actionRow({
                type: ComponentType.StringSelect,
                custom_id: componentCustomId(COMMAND_NAME, ACTION_SORT),
                options: Object.values(LeaderboardSort).map((value) => ({
                    label: SORT_OPTIONS[value].label,
                    value,
                    emoji: { name: SORT_OPTIONS[value].emoji },
                    default: value === sort,
                })),
            }),
            text(view.description),
            separator(),
            shareFooter(stats, {
                shareId: componentCustomId(COMMAND_NAME, `${ACTION_SHARE}:${sort}:${currentPage}`),
            }),
            // A row holds buttons or a select, never both: the page number is a greyed-out
            // button between the arrows rather than a page select.
            actionRow(
                pageButton('⏮', ACTION_FIRST, sort, 1, onFirst),
                pageButton('◀', ACTION_PREV, sort, Math.max(1, currentPage - 1), onFirst),
                pageButton(`${currentPage}/${totalPages}`, ACTION_PAGE, sort, currentPage, true),
                pageButton('▶', ACTION_NEXT, sort, Math.min(totalPages, currentPage + 1), onLast),
                pageButton('⏭', ACTION_LAST, sort, totalPages, onLast),
            ),
        ),
    ];
}

async function handleLeaderboardCommand(req: Request, res: Response): Promise<void> {
    try {
        const body = req.body as InteractionBody;
        const { guild_id } = body;
        const requesterId = body.member?.user?.id ?? body.user?.id;

        if (!requireGuild(res, guild_id)) return;

        const panel = await leaderboardPanel(guild_id, LeaderboardSort.MAX, 1, requesterId);
        replyComponents(res, panel, { ephemeral: true, suppressMentions: true });
    } catch (error) {
        console.error('Error handling leaderboard command:', error);
        replyText(res, 'Une erreur est survenue en récupérant le classement.', {
            ephemeral: true,
        });
    }
}

/**
 * Share posts the page being viewed publicly, pinned to the sharer; every other click pages
 * or sorts the private panel in place.
 */
async function handleLeaderboardComponent(
    req: Request,
    res: Response,
    action: string,
): Promise<void> {
    const body = req.body as InteractionBody;
    const [kind, rawSort, rawPage] = action.split(':');

    let sort: LeaderboardSort;
    let page: number;
    if (PAGE_ACTIONS.includes(kind) || kind === ACTION_SHARE) {
        sort = parseLeaderboardSort(rawSort);
        page = parseLeaderboardPage(Number(rawPage));
    } else if (kind === ACTION_SORT) {
        sort = parseLeaderboardSort(body.data?.values?.[0]);
        page = 1;
    } else {
        console.error(`unknown leaderboard action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    try {
        const { guild_id } = body;
        if (!requireGuild(res, guild_id)) return;

        const clickerId = body.member?.user?.id ?? body.user?.id;

        if (kind === ACTION_SHARE) {
            if (!clickerId) {
                replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
                return;
            }
            const panel = await leaderboardPanel(guild_id, sort, page, clickerId, clickerId);
            replyComponents(res, panel, { suppressMentions: true });
            return;
        }

        const panel = await leaderboardPanel(guild_id, sort, page, clickerId);
        updateComponents(res, panel, { suppressMentions: true });
    } catch (error) {
        console.error('Error handling leaderboard click:', error);
        replyText(res, 'Une erreur est survenue en récupérant le classement.', {
            ephemeral: true,
        });
    }
}

export const leaderboardCommand: Command = {
    definition: {
        name: COMMAND_NAME,
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
    },
    handler: handleLeaderboardCommand,
    onComponent: handleLeaderboardComponent,
};
