import {
    readJsonFileSync,
    writeJsonFileSync,
    AllowedFiles,
} from '../commons/files.js';
import { bn, bnAdd, bnSub, bnMax, bnFromJSON, bnToJSON, bnLt, bnCompare, type BigNum } from '../commons/big-number.js';
import { computeNewStreak, getTodayString } from './streak.js';
import type { ShellsUser, LeaderboardEntry, PaginatedLeaderboard } from './types.js';

export const DEFAULT_SHELLS_PER_MESSAGE = 10;

export function readShellsData(guildId: string): ShellsUser[] {
    return readJsonFileSync(guildId, AllowedFiles.SHELLS);
}

export function writeShellsData(guildId: string, data: ShellsUser[]): void {
    writeJsonFileSync(guildId, AllowedFiles.SHELLS, data);
}

export function getShellsPerMessage(guildId: string, userId: string): BigNum {
    const user = readShellsData(guildId).find((u) => u.userId === userId);
    return bnFromJSON(user?.shellsPerMessage ?? DEFAULT_SHELLS_PER_MESSAGE);
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
    shellsToAdd: BigNum,
): { newShells: BigNum; maxShells: BigNum } {
    const users = readShellsData(guildId);
    const userIndex = users.findIndex((u) => u.userId === userId);

    let newShells: BigNum;
    let maxShells: BigNum;

    if (userIndex === -1) {
        newShells = shellsToAdd;
        maxShells = shellsToAdd;
        users.push({
            userId,
            shells: bnToJSON(newShells),
            maxShells: bnToJSON(maxShells),
            shellsPerMessage: String(DEFAULT_SHELLS_PER_MESSAGE),
        });
    } else {
        newShells = bnAdd(bnFromJSON(users[userIndex]!.shells), shellsToAdd);
        maxShells = bnMax(bnFromJSON(users[userIndex]!.maxShells), newShells);
        users[userIndex]!.shells = bnToJSON(newShells);
        users[userIndex]!.maxShells = bnToJSON(maxShells);
    }

    writeShellsData(guildId, users);

    return { newShells, maxShells };
}

/**
 * Updates the daily streak for a user and persists it to shells.json.
 * Safe to call multiple times per day — idempotent when already counted today.
 * Returns the current (possibly updated) streak count.
 */
export function updateUserStreak(guildId: string, userId: string): number {
    const users = readShellsData(guildId);
    const userIndex = users.findIndex((u) => u.userId === userId);

    if (userIndex === -1) {
        // User doesn't exist yet; addUserShells will create the record, nothing to do.
        return 1;
    }

    const user = users[userIndex]!;
    const today = getTodayString();
    const { streak, lastStreakDate } = computeNewStreak(
        user.streak ?? 0,
        user.lastStreakDate,
        today,
    );

    if (streak !== user.streak || lastStreakDate !== user.lastStreakDate) {
        user.streak = streak;
        user.lastStreakDate = lastStreakDate;
        writeShellsData(guildId, users);
    }

    return streak;
}

export function getShellsLeaderboard(guildId: string): ShellsUser[] {
    const users = readShellsData(guildId);
    return [...users].sort((a, b) => {
        const aMax = bnFromJSON(a.maxShells ?? a.shells);
        const bMax = bnFromJSON(b.maxShells ?? b.shells);
        return bnCompare(bMax, aMax); // décroissant : b avant a
    });
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
        shells: bnFromJSON(leaderboard[userIndex]!.shells),
        maxShells: bnFromJSON(leaderboard[userIndex]!.maxShells ?? leaderboard[userIndex]!.shells),
        shellsPerMessage: bnFromJSON(leaderboard[userIndex]!.shellsPerMessage ?? DEFAULT_SHELLS_PER_MESSAGE),
        userId,
    };
}

export function getUserShells(guildId: string, userId: string): BigNum {
    const user = getUserShellsData(guildId, userId);
    return user ? bnFromJSON(user.shells) : bn(0);
}

export function spendUserShells(
    guildId: string,
    userId: string,
    amount: BigNum,
): { newShells: BigNum } | null {
    const users = readShellsData(guildId);
    const index = users.findIndex((u) => u.userId === userId);
    if (index === -1 || bnLt(bnFromJSON(users[index]!.shells), amount)) return null;
    const newShells = bnSub(bnFromJSON(users[index]!.shells), amount);
    users[index]!.shells = bnToJSON(newShells);
    writeShellsData(guildId, users);
    return { newShells };
}

export function updateUserShellsPerMessage(
    guildId: string,
    userId: string,
    shellsPerMessage: BigNum,
): void {
    const users = readShellsData(guildId);
    const index = users.findIndex((u) => u.userId === userId);
    if (index === -1) return;
    users[index]!.shellsPerMessage = bnToJSON(shellsPerMessage);
    writeShellsData(guildId, users);
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
