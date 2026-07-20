import { bnCompare, type BigNum } from './core/big-number.ts';
import type { ReadonlyGameInstance } from './core/game-instance.ts';
import { ResourceId } from './core/types.ts';

export enum LeaderboardSort {
    MAX = 'max',
    CURRENT = 'current',
    INCOME = 'income',
}

export type LeaderboardEntry = {
    rank: number;
    userId: string;
    shells: BigNum;
    maxShells: BigNum;
    shellsPerMessage: BigNum;
};

type PaginatedLeaderboard = {
    entries: LeaderboardEntry[];
    totalUsers: number;
    totalPages: number;
    currentPage: number;
    startIndex: number;
    pageSize: number;
};

const DEFAULT_PAGE_SIZE = 10;

export class Leaderboard {
    private readonly _entries: LeaderboardEntry[];

    constructor(instances: ReadonlyGameInstance[], sort: LeaderboardSort = LeaderboardSort.MAX) {
        this._entries = Leaderboard._buildRanked(instances, sort);
    }

    private static _sortKey(instance: ReadonlyGameInstance, sort: LeaderboardSort): BigNum {
        switch (sort) {
            case LeaderboardSort.CURRENT:
                return instance.resources[ResourceId.SHELLS];
            case LeaderboardSort.INCOME:
                return instance.income[ResourceId.SHELLS];
            case LeaderboardSort.MAX:
                return instance.stats.maxShells;
        }
    }

    private static _buildRanked(
        instances: ReadonlyGameInstance[],
        sort: LeaderboardSort,
    ): LeaderboardEntry[] {
        return [...instances]
            .sort((a, b) => bnCompare(Leaderboard._sortKey(b, sort), Leaderboard._sortKey(a, sort)))
            .map((instance, index) => ({
                rank: index + 1,
                userId: instance.userId,
                shells: instance.resources[ResourceId.SHELLS],
                maxShells: instance.stats.maxShells,
                shellsPerMessage: instance.income[ResourceId.SHELLS],
            }));
    }

    getPage(requestedPage = 1, pageSize = DEFAULT_PAGE_SIZE): PaginatedLeaderboard {
        // Normalized before the empty check, so every branch reports the size it would use.
        const safePageSize =
            Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

        if (this._entries.length === 0) {
            return {
                entries: [],
                totalUsers: 0,
                totalPages: 0,
                currentPage: 1,
                startIndex: 0,
                pageSize: safePageSize,
            };
        }

        const totalUsers = this._entries.length;
        const totalPages = Math.ceil(totalUsers / safePageSize);
        const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
        const startIndex = (currentPage - 1) * safePageSize;
        const entries = this._entries.slice(startIndex, startIndex + safePageSize);

        return { entries, totalUsers, totalPages, currentPage, startIndex, pageSize: safePageSize };
    }

    getUserEntry(userId: string): LeaderboardEntry | null {
        return this._entries.find((e) => e.userId === userId) ?? null;
    }

    get totalUsers(): number {
        return this._entries.length;
    }
}
