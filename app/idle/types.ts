export type ShellsUser = {
    userId: string;
    shells: number;
    maxShells?: number;
}

export type RoleChanges = {
    added: string | null;
    addedRoleName: string | null;
    removed: string[];
}

export type LeaderboardEntry = {
    rank: number;
    shells: number;
    maxShells: number;
    userId: string;
}

export type PaginatedLeaderboard = {
    users: ShellsUser[];
    totalUsers: number;
    totalPages: number;
    currentPage: number;
    startIndex: number;
    pageSize: number;
}
