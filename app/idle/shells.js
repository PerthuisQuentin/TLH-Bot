import {
  addUserShells,
  getShellsLeaderboard,
  getUserLeaderboardEntry,
  getUserShells,
  getPaginatedShellsLeaderboard,
} from './shells-storage.js';
import { updateMemberShellsRoles } from './shells-roles.js';
import { readJsonFile, AllowedFiles } from '../commons/files.js';
import { memoryCache } from '../commons/memory.js';
import { generateRolePromotionMessage } from '../gemini/ask-gemini.js';
import { formatDiscordJsMessage } from '../commons/messages.js';

const SHELLS_COOLDOWN = 10; // 10 seconds

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

/**
 * Handle shells attribution on a Discord message event
 * @param {import('discord.js').Message} message - The Discord message
 * @returns {Promise<void>}
 */
export async function handleMessageShells(message) {
  // Check if channel is excluded from shells
  const config = await readJsonFile(message.guildId, AllowedFiles.CONFIG, {});
  const noShellChannels = config.noShellChannels ?? [];
  if (noShellChannels.includes(message.channelId)) {
    return;
  }

  // Check for spam (cooldown)
  const cacheKey = `shells:${message.guildId}:${message.author.id}`;
  if (memoryCache.has(cacheKey)) {
    return;
  }

  // Add shells to user (random 1-10) with role updates
  const { roleChanges } = await addShells(
    message.author.id,
    message.guildId,
    null,
    message.member,
  );

  // Send promotion message if a new role was added
  if (roleChanges.added && roleChanges.addedRoleName) {
    try {
      const conversationContext = formatDiscordJsMessage(message) || '';

      const promotionMessage = await generateRolePromotionMessage({
        guildId: message.guildId,
        channelName: message.channel.name || 'canal',
        conversationContext,
        userName: message.member.displayName,
        roleName: roleChanges.addedRoleName,
      });
      await message.channel.send(`<@${message.author.id}> ${promotionMessage}`);
    } catch (error) {
      console.error(
        `[Bot] Error sending promotion | userId=${message.author.id}`,
        error,
      );
    }
  }

  // Set cooldown (TTL in seconds)
  memoryCache.set(cacheKey, true, SHELLS_COOLDOWN);
}
