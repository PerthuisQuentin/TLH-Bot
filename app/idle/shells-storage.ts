import {
    readJsonFileSync,
    writeJsonFileSync,
    AllowedFiles,
} from '../commons/files.js';
import type { ShellsUser, LeaderboardEntry, PaginatedLeaderboard } from './types.js';

export function readShellsData(guildId: string): ShellsUser[] {
    return readJsonFileSync(guildId, AllowedFiles.SHELLS);
}

export function writeShellsData(guildId: string, data: ShellsUser[]): void {
    writeJsonFileSync(guildId, AllowedFiles.SHELLS, data);
}

export function getUserShellsData(
    guildId: string,
    userId: string,
): ShellsUser | null {
    const users = readShellsData(guildId);
    return users.find((u) => u.userId === userId) ?? null;
}

export function addUserShells(
    guildId: string,
    userId: string,
    shellsToAdd: number,
): { newShells: number; maxShells: number } {
    const users = readShellsData(guildId);
    const userIndex = users.findIndex((u) => u.userId === userId);

    let newShells: number;
    let maxShells: number;

    if (userIndex === -1) {
        newShells = shellsToAdd;
        maxShells = shellsToAdd;
        users.push({ userId, shells: newShells, maxShells });
    } else {
        users[userIndex].shells += shellsToAdd;
        newShells = users[userIndex].shells;
        const currentMaxShells = users[userIndex].maxShells ?? users[userIndex].shells;
        maxShells = Math.max(currentMaxShells, newShells);
        users[userIndex].maxShells = maxShells;
    }

    writeShellsData(guildId, users);

    return { newShells, maxShells };
}

export function getShellsLeaderboard(guildId: string): ShellsUser[] {
    const users = readShellsData(guildId);
    return [...users].sort((a, b) => b.shells - a.shells);
}

export function getUserLeaderboardEntry(
    guildId: string,
    userId: string,
): LeaderboardEntry | null {
    if (!userId) return null;

    const leaderboard = getShellsLeaderboard(guildId);
    const userIndex = leaderboard.findIndex((user) => user.userId === userId);

    if (userIndex === -1) return null;

    return {
        rank: userIndex + 1,
        shells: leaderboard[userIndex].shells,
        maxShells: leaderboard[userIndex].maxShells ?? leaderboard[userIndex].shells,
        userId,
    };
}

export function getUserShells(guildId: string, userId: string): number {
    const user = getUserShellsData(guildId, userId);
    return user ? user.shells : 0;
}

export function getPaginatedShellsLeaderboard(
    guildId: string,
    requestedPage = 1,
    pageSize = 10,
): PaginatedLeaderboard {
    const leaderboard = getShellsLeaderboard(guildId);

    if (leaderboard.length === 0) {
        return { users: [], totalUsers: 0, totalPages: 0, currentPage: 1, startIndex: 0, pageSize };
    }

    const safePageSize =
        Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
    const safeRequestedPage =
        Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const totalUsers = leaderboard.length;
    const totalPages = Math.ceil(totalUsers / safePageSize);
    const currentPage = Math.min(safeRequestedPage, totalPages);
    const startIndex = (currentPage - 1) * safePageSize;
    const users = leaderboard.slice(startIndex, startIndex + safePageSize);

    return { users, totalUsers, totalPages, currentPage, startIndex, pageSize: safePageSize };
}
