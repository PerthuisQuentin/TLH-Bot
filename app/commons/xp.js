import { readJsonFileSync, writeJsonFileSync, AllowedFiles } from './files.js';

/**
 * Add XP to a user in a guild
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} xpAmount - Amount of XP to add (default: random 1-10)
 */
export function addXP(userId, guildId, xpAmount = null) {
  try {
    // Generate random XP between 1 and 10 if not specified
    const finalXpAmount = xpAmount ?? Math.floor(Math.random() * 10) + 1;

    let users = readJsonFileSync(guildId, AllowedFiles.XP, []);

    const userIndex = users.findIndex((u) => u.userId === userId);

    if (userIndex === -1) {
      users.push({ userId, xp: finalXpAmount });
    } else {
      users[userIndex].xp += finalXpAmount;
    }

    writeJsonFileSync(guildId, AllowedFiles.XP, users);

    console.log(
      `[XP] +${finalXpAmount} XP for userId=${userId} in guildId=${guildId}`,
    );
  } catch (error) {
    console.error('Error adding XP:', error);
  }
}

/**
 * Get XP leaderboard for a guild
 * @param {string} guildId - Discord guild ID
 */
export function getXpLeaderboard(guildId) {
  try {
    const users = readJsonFileSync(guildId, AllowedFiles.XP, []);
    return users.sort((a, b) => b.xp - a.xp);
  } catch (error) {
    console.error('Error getting XP leaderboard:', error);
    return [];
  }
}

/**
 * Get paginated XP leaderboard data for a guild
 * @param {string} guildId - Discord guild ID
 * @param {number} requestedPage - Requested page number
 * @param {number} pageSize - Number of users per page
 */
export function getPaginatedXpLeaderboard(
  guildId,
  requestedPage = 1,
  pageSize = 10,
) {
  const leaderboard = getXpLeaderboard(guildId);

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

/**
 * Get user rank and XP in guild leaderboard
 * @param {string} guildId - Discord guild ID
 * @param {string} userId - Discord user ID
 */
export function getUserLeaderboardEntry(guildId, userId) {
  if (!userId) {
    return null;
  }

  const leaderboard = getXpLeaderboard(guildId);
  const userIndex = leaderboard.findIndex((user) => user.userId === userId);

  if (userIndex === -1) {
    return null;
  }

  return {
    rank: userIndex + 1,
    xp: leaderboard[userIndex].xp,
    userId,
  };
}

/**
 * Get user XP in a guild
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 */
export function getUserXp(userId, guildId) {
  try {
    const users = readJsonFileSync(guildId, AllowedFiles.XP, []);
    const user = users.find((u) => u.userId === userId);

    return user ? user.xp : 0;
  } catch (error) {
    console.error('Error getting user XP:', error);
    return 0;
  }
}
