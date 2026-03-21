import {
  addUserShells,
  getShellsLeaderboard,
  getUserLeaderboardEntry,
  getUserShells,
  getPaginatedShellsLeaderboard,
} from './shells-storage.js';
import { updateMemberShellsRoles } from './shells-roles.js';

// Re-export storage functions for external use
export {
  getShellsLeaderboard,
  getUserLeaderboardEntry,
  getUserShells,
  getPaginatedShellsLeaderboard,
};

/**
 * Add shells to a user in a guild
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {number} shellsAmount - Amount of shells to add (default: random 1-10)
 * @param {import('discord.js').GuildMember} [member] - Optional guild member for role updates
 * @returns {Promise<{newShells: number, maxShells: number, roleChanges: {added: string|null, addedRoleName: string|null, removed: string[]}}>}
 */
export async function addShells(
  userId,
  guildId,
  shellsAmount = null,
  member = null,
) {
  try {
    // Generate random shells between 1 and 10 if not specified
    const finalShellsAmount =
      shellsAmount ?? Math.floor(Math.random() * 10) + 1;

    const { newShells, maxShells } = addUserShells(
      guildId,
      userId,
      finalShellsAmount,
    );

    console.log(
      `[Shells] Added | userId=${userId} | guildId=${guildId} | amount=${finalShellsAmount} | total=${newShells} | maxShells=${maxShells}`,
    );

    // Update shells roles based on maxShells if member is provided
    let roleChanges = { added: null, addedRoleName: null, removed: [] };
    if (member) {
      try {
        roleChanges = await updateMemberShellsRoles(member, maxShells);
      } catch (roleError) {
        console.error(
          `[Shells] Error updating roles | userId=${userId}`,
          roleError,
        );
      }
    }

    return { newShells, maxShells, roleChanges };
  } catch (error) {
    console.error(
      `[Shells] Error adding | userId=${userId} | guildId=${guildId}`,
      error,
    );
    return {
      newShells: 0,
      maxShells: 0,
      roleChanges: { added: null, addedRoleName: null, removed: [] },
    };
  }
}
