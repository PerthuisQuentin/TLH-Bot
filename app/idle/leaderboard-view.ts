import { Leaderboard, LeaderboardSort, type LeaderboardEntry } from './leaderboard.ts';
import { getAllGameInstances } from './game-instance-storage.ts';
import { formatBigNum } from './core/big-number.ts';

function formatLeaderboardEntry(entry: LeaderboardEntry, sort: LeaderboardSort): string {
    if (sort === LeaderboardSort.RINGS) {
        return `#${entry.rank} <@${entry.userId}> — 🌀 ${entry.growthRingDays} j (×${entry.growthRingsMultiplier.toFixed(2)}) · ${formatBigNum(entry.maxShells)} 🐚`;
    }
    return `#${entry.rank} <@${entry.userId}> — ${formatBigNum(entry.maxShells)} 🐚 *(${formatBigNum(entry.shells)} · +${formatBigNum(entry.shellsPerMessage)}/msg)*`;
}

/** Falls back to `MAX` for anything but a recognized sort value — same rule for `/leaderboard`'s option and the LLM tool's free-text arg. */
export function parseLeaderboardSort(value: string | undefined): LeaderboardSort {
    return (Object.values(LeaderboardSort) as string[]).includes(value ?? '')
        ? (value as LeaderboardSort)
        : LeaderboardSort.MAX;
}

/** Falls back to page 1 for anything but a positive integer. */
export function parseLeaderboardPage(value: number | undefined): number {
    return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 1;
}

/**
 * One page of the Coquillages leaderboard, shared by the `/leaderboard` embed and the
 * `get_leaderboard` LLM tool so neither re-derives the other's text — only how it's
 * wrapped (embed vs. a flowing text block) differs.
 */
export type LeaderboardView = {
    isEmpty: boolean;
    /** Empty string when `isEmpty`. */
    description: string;
    sort: LeaderboardSort;
    currentPage: number;
    totalPages: number;
    totalUsers: number;
};

export type GetLeaderboardViewParams = {
    sort?: LeaderboardSort;
    page?: number;
    /** Appended (bolded, even off the page) so this member's rank is always visible. */
    pinnedUserId?: string;
};

export async function getLeaderboardView(
    guildId: string,
    { sort = LeaderboardSort.MAX, page = 1, pinnedUserId }: GetLeaderboardViewParams = {},
): Promise<LeaderboardView> {
    const instances = await getAllGameInstances(guildId);
    const leaderboard = new Leaderboard(instances, sort);

    if (leaderboard.totalUsers === 0) {
        return {
            isEmpty: true,
            description: '',
            sort,
            currentPage: 1,
            totalPages: 0,
            totalUsers: 0,
        };
    }

    const paginated = leaderboard.getPage(page);
    const pinnedEntry = pinnedUserId ? leaderboard.getUserEntry(pinnedUserId) : null;

    const leaderboardText = paginated.entries
        .map((entry) => {
            const line = formatLeaderboardEntry(entry, sort);
            return pinnedUserId && entry.userId === pinnedUserId ? `**${line}**` : line;
        })
        .join('\n');

    const pinnedIsOnPage =
        pinnedEntry !== null &&
        pinnedEntry.rank > paginated.startIndex &&
        pinnedEntry.rank <= paginated.startIndex + paginated.pageSize;

    let description = leaderboardText;
    if (pinnedUserId && !pinnedIsOnPage) {
        description = pinnedEntry
            ? `${leaderboardText}\n—\n**${formatLeaderboardEntry(pinnedEntry, sort)}**`
            : `${leaderboardText}\n\n—\n**Non classé • <@${pinnedUserId}>**`;
    }

    return {
        isEmpty: false,
        description,
        sort,
        currentPage: paginated.currentPage,
        totalPages: paginated.totalPages,
        totalUsers: paginated.totalUsers,
    };
}
