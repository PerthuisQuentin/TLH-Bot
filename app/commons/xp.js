import { readJsonFileSync, writeJsonFileSync, AllowedFiles } from './files.js';
import { memoryCache } from './memory.js';

const CONFIG_CACHE_TTL = 60; // 1 minute

/**
 * Get XP roles configuration for a guild (cached)
 * @param {string} guildId - Discord guild ID
 * @returns {Array<{roleId: string, threshold: number}>} Sorted list of roles by threshold
 */
export function getXpRolesConfig(guildId) {
  const cacheKey = `config:${guildId}`;

  // Check cache first
  const cached = memoryCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const config = readJsonFileSync(guildId, AllowedFiles.CONFIG, {});
  const xpRoles = config.xpRoles || [];
  // Sort by threshold ascending
  const sortedRoles = [...xpRoles].sort((a, b) => a.threshold - b.threshold);

  // Cache the result
  memoryCache.set(cacheKey, sortedRoles, CONFIG_CACHE_TTL);

  return sortedRoles;
}

/**
 * Get the appropriate role for a given XP amount
 * @param {string} guildId - Discord guild ID
 * @param {number} xp - User's XP amount
 * @returns {{roleId: string, threshold: number} | null} The role to assign or null
 */
export function getRoleForXp(guildId, xp) {
  const xpRoles = getXpRolesConfig(guildId);
  if (xpRoles.length === 0) return null;

  // Find the highest role the user qualifies for
  let qualifiedRole = null;
  for (const role of xpRoles) {
    if (xp >= role.threshold) {
      qualifiedRole = role;
    } else {
      break;
    }
  }
  return qualifiedRole;
}

/**
 * Update XP roles for a guild member based on maxXp
 * @param {import('discord.js').GuildMember} member - Discord guild member
 * @param {number} maxXp - User's max XP amount (highest ever reached)
 * @returns {Promise<{added: string|null, removed: string[]}>} Role changes made
 */
export async function updateMemberXpRoles(member, maxXp) {
  const guildId = member.guild.id;
  const xpRoles = getXpRolesConfig(guildId);

  if (xpRoles.length === 0) {
    return { added: null, removed: [] };
  }

  const xpRoleIds = xpRoles.map((r) => r.roleId);
  const targetRole = getRoleForXp(guildId, maxXp);
  const targetRoleId = targetRole?.roleId || null;

  // Get current XP roles the member has
  const currentXpRoles = member.roles.cache.filter((role) =>
    xpRoleIds.includes(role.id),
  );

  const rolesToRemove = [];
  let roleToAdd = null;

  // Check if member needs the target role
  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    roleToAdd = targetRoleId;
  }

  // Remove all other XP roles
  for (const [roleId] of currentXpRoles) {
    if (roleId !== targetRoleId) {
      rolesToRemove.push(roleId);
    }
  }

  // Apply role changes
  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove);
    console.log(
      `[XP] Role removed | userId=${member.id} | roleIds=${rolesToRemove.join(',')}`,
    );
  }

  let addedRoleName = null;
  if (roleToAdd) {
    await member.roles.add(roleToAdd);
    // Get the role name from cache
    const role = member.guild.roles.cache.get(roleToAdd);
    addedRoleName = role?.name || null;
    console.log(
      `[XP] Role added | userId=${member.id} | roleId=${roleToAdd} | roleName=${addedRoleName}`,
    );
  }

  return { added: roleToAdd, addedRoleName, removed: rolesToRemove };
}

/**
 * Add XP to a user in a guild
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} xpAmount - Amount of XP to add (default: random 1-10)
 * @param {import('discord.js').GuildMember} [member] - Optional guild member for role updates
 * @returns {Promise<{newXp: number, maxXp: number, roleChanges: {added: string|null, addedRoleName: string|null, removed: string[]}}>}
 */
export async function addXP(userId, guildId, xpAmount = null, member = null) {
  try {
    // Generate random XP between 1 and 10 if not specified
    const finalXpAmount = xpAmount ?? Math.floor(Math.random() * 10) + 1;

    let users = readJsonFileSync(guildId, AllowedFiles.XP, []);

    const userIndex = users.findIndex((u) => u.userId === userId);
    let newXp;
    let maxXp;

    if (userIndex === -1) {
      newXp = finalXpAmount;
      maxXp = finalXpAmount;
      users.push({ userId, xp: newXp, maxXp });
    } else {
      users[userIndex].xp += finalXpAmount;
      newXp = users[userIndex].xp;
      // Update maxXp if current xp exceeds it
      const currentMaxXp = users[userIndex].maxXp ?? users[userIndex].xp;
      maxXp = Math.max(currentMaxXp, newXp);
      users[userIndex].maxXp = maxXp;
    }

    writeJsonFileSync(guildId, AllowedFiles.XP, users);

    console.log(
      `[XP] Added | userId=${userId} | guildId=${guildId} | amount=${finalXpAmount} | total=${newXp} | maxXp=${maxXp}`,
    );

    // Update XP roles based on maxXp if member is provided
    let roleChanges = { added: null, addedRoleName: null, removed: [] };
    if (member) {
      try {
        roleChanges = await updateMemberXpRoles(member, maxXp);
      } catch (roleError) {
        console.error(
          `[XP] Error updating roles | userId=${userId}`,
          roleError,
        );
      }
    }

    return { newXp, maxXp, roleChanges };
  } catch (error) {
    console.error(
      `[XP] Error adding | userId=${userId} | guildId=${guildId}`,
      error,
    );
    return {
      newXp: 0,
      maxXp: 0,
      roleChanges: { added: null, addedRoleName: null, removed: [] },
    };
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
    maxXp: leaderboard[userIndex].maxXp ?? leaderboard[userIndex].xp,
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
