export interface ShellsUser {
    userId: string;
    shells: number;
    maxShells?: number;
}

export interface RoleChanges {
    added: string | null;
    addedRoleName: string | null;
    removed: string[];
}

export interface LeaderboardEntry {
    rank: number;
    shells: number;
    maxShells: number;
    userId: string;
}

export interface PaginatedLeaderboard {
    users: ShellsUser[];
    totalUsers: number;
    totalPages: number;
    currentPage: number;
    startIndex: number;
    pageSize: number;
}
