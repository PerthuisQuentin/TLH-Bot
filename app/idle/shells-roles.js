import { readJsonFileSync, AllowedFiles } from '../commons/files.js';
import { memoryCache } from '../commons/memory.js';

const CONFIG_CACHE_TTL = 60; // 1 minute

/**
 * Get Shells roles configuration for a guild (cached)
 * @param {string} guildId - Discord guild ID
 * @returns {Array<{roleId: string, threshold: number}>} Sorted list of roles by threshold
 */
export function getShellsRolesConfig(guildId) {
  const cacheKey = `shellsRoles:${guildId}`;

  // Check cache first
  const cached = memoryCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const config = readJsonFileSync(guildId, AllowedFiles.CONFIG, {});
  const shellsRoles = config.shellsRoles || [];
  // Sort by threshold ascending
  const sortedRoles = [...shellsRoles].sort(
    (a, b) => a.threshold - b.threshold,
  );

  // Cache the result
  memoryCache.set(cacheKey, sortedRoles, CONFIG_CACHE_TTL);

  return sortedRoles;
}

/**
 * Get the appropriate role for a given shells amount
 * @param {string} guildId - Discord guild ID
 * @param {number} shells - User's shells amount
 * @returns {{roleId: string, threshold: number} | null} The role to assign or null
 */
export function getRoleForShells(guildId, shells) {
  const shellsRoles = getShellsRolesConfig(guildId);
  if (shellsRoles.length === 0) return null;

  // Find the highest role the user qualifies for
  let qualifiedRole = null;
  for (const role of shellsRoles) {
    if (shells >= role.threshold) {
      qualifiedRole = role;
    } else {
      break;
    }
  }
  return qualifiedRole;
}

/**
 * Update shells roles for a guild member based on maxShells
 * @param {import('discord.js').GuildMember} member - Discord guild member
 * @param {number} maxShells - User's max shells amount (highest ever reached)
 * @returns {Promise<{added: string|null, addedRoleName: string|null, removed: string[]}>} Role changes made
 */
export async function updateMemberShellsRoles(member, maxShells) {
  const guildId = member.guild.id;
  const shellsRoles = getShellsRolesConfig(guildId);

  if (shellsRoles.length === 0) {
    return { added: null, addedRoleName: null, removed: [] };
  }

  const shellsRoleIds = shellsRoles.map((r) => r.roleId);
  const targetRole = getRoleForShells(guildId, maxShells);
  const targetRoleId = targetRole?.roleId || null;

  // Get current shells roles the member has
  const currentShellsRoles = member.roles.cache.filter((role) =>
    shellsRoleIds.includes(role.id),
  );

  const rolesToRemove = [];
  let roleToAdd = null;

  // Check if member needs the target role
  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    roleToAdd = targetRoleId;
  }

  // Remove all other shells roles
  for (const [roleId] of currentShellsRoles) {
    if (roleId !== targetRoleId) {
      rolesToRemove.push(roleId);
    }
  }

  // Apply role changes
  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove);
    console.log(
      `[Shells] Role removed | userId=${member.id} | roleIds=${rolesToRemove.join(',')}`,
    );
  }

  let addedRoleName = null;
  if (roleToAdd) {
    await member.roles.add(roleToAdd);
    // Get the role name from cache
    const role = member.guild.roles.cache.get(roleToAdd);
    addedRoleName = role?.name || null;
    console.log(
      `[Shells] Role added | userId=${member.id} | roleId=${roleToAdd} | roleName=${addedRoleName}`,
    );
  }

  return { added: roleToAdd, addedRoleName, removed: rolesToRemove };
}
