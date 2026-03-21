import {
  readJsonFileSync,
  writeJsonFileSync,
  AllowedFiles,
} from '../commons/files.js';

/**
 * Read all shells data for a guild
 * @param {string} guildId - Discord guild ID
 * @returns {Array<{userId: string, shells: number, maxShells?: number}>}
 */
export function readShellsData(guildId) {
  return readJsonFileSync(guildId, AllowedFiles.SHELLS, []);
}

/**
 * Write all shells data for a guild
 * @param {string} guildId - Discord guild ID
 * @param {Array<{userId: string, shells: number, maxShells?: number}>} data
 */
export function writeShellsData(guildId, data) {
  writeJsonFileSync(guildId, AllowedFiles.SHELLS, data);
}

/**
 * Get shells data for a specific user
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @returns {{userId: string, shells: number, maxShells?: number} | null}
 */
export function getUserShellsData(guildId, userId) {
  const users = readShellsData(guildId);
  return users.find((u) => u.userId === userId) || null;
}

/**
 * Update or create shells data for a user
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @param {number} shellsToAdd - Amount of shells to add
 * @returns {{newShells: number, maxShells: number}}
 */
export function addUserShells(guildId, userId, shellsToAdd) {
  const users = readShellsData(guildId);
  const userIndex = users.findIndex((u) => u.userId === userId);

  let newShells;
  let maxShells;

  if (userIndex === -1) {
    newShells = shellsToAdd;
    maxShells = shellsToAdd;
    users.push({ userId, shells: newShells, maxShells });
  } else {
    users[userIndex].shells += shellsToAdd;
    newShells = users[userIndex].shells;
    const currentMaxShells =
      users[userIndex].maxShells ?? users[userIndex].shells;
    maxShells = Math.max(currentMaxShells, newShells);
    users[userIndex].maxShells = maxShells;
  }

  writeShellsData(guildId, users);

  return { newShells, maxShells };
}

/**
 * Get shells leaderboard for a guild (sorted by shells descending)
 * @param {string} guildId - Discord guild ID
 * @returns {Array<{userId: string, shells: number, maxShells?: number}>}
 */
export function getShellsLeaderboard(guildId) {
  const users = readShellsData(guildId);
  return [...users].sort((a, b) => b.shells - a.shells);
}

/**
 * Get user rank and shells in guild leaderboard
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @returns {{rank: number, shells: number, maxShells: number, userId: string} | null}
 */
export function getUserLeaderboardEntry(guildId, userId) {
  if (!userId) {
    return null;
  }

  const leaderboard = getShellsLeaderboard(guildId);
  const userIndex = leaderboard.findIndex((user) => user.userId === userId);

  if (userIndex === -1) {
    return null;
  }

  return {
    rank: userIndex + 1,
    shells: leaderboard[userIndex].shells,
    maxShells:
      leaderboard[userIndex].maxShells ?? leaderboard[userIndex].shells,
    userId,
  };
}

/**
 * Get user shells amount in a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 * @returns {number}
 */
export function getUserShells(guildId, userId) {
  const user = getUserShellsData(guildId, userId);
  return user ? user.shells : 0;
}

/**
 * Get paginated shells leaderboard data for a guild
 * @param {string} guildId - Discord guild ID
 * @param {number} requestedPage - Requested page number
 * @param {number} pageSize - Number of users per page
 */
export function getPaginatedShellsLeaderboard(
  guildId,
  requestedPage = 1,
  pageSize = 10,
) {
  const leaderboard = getShellsLeaderboard(guildId);

  if (leaderboard.length === 0) {
    return {
      users: [],
      totalUsers: 0,
      totalPages: 0,
      currentPage: 1,
      startIndex: 0,
      pageSize,
    };
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

  return {
    users,
    totalUsers,
    totalPages,
    currentPage,
    startIndex,
    pageSize: safePageSize,
  };
}
