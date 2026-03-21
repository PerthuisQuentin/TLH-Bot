import { Client, GatewayIntentBits } from 'discord.js';
import { addShells } from './app/idle/shells.js';
import { memoryCache } from './app/commons/memory.js';
import { generateRolePromotionMessage } from './app/gemini/ask-gemini.js';
import { formatDiscordJsMessage } from './app/commons/messages.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const SHELLS_COOLDOWN = 10; // 10 seconds

client.once('clientReady', () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Skip DMs
  if (!message.guild) {
    return;
  }

  // Check for spam (cooldown)
  const cacheKey = `shells:${message.guildId}:${message.author.id}`;
  if (memoryCache.has(cacheKey)) {
    // User is on cooldown, no shells
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
});

client.on('error', (error) => {
  console.error('[Bot] Error', error);
});

client.on('shardError', (error) => {
  console.error('[Bot] Shard error', error);
});

/**
 * Login the bot
 */
export async function startBot() {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('[Bot] Failed to login:', error);
    process.exit(1);
  }
}

export { client };
