import { Client, GatewayIntentBits } from 'discord.js';
import { addXP } from './app/commons/xp.js';
import { memoryCache } from './app/commons/memory.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const XP_COOLDOWN = 10; // 10 seconds

client.once('clientReady', () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Skip DMs
  if (!message.guild) {
    return;
  }

  // Check for spam (cooldown)
  const cacheKey = `xp:${message.guildId}:${message.author.id}`;
  if (memoryCache.has(cacheKey)) {
    // User is on cooldown, no XP
    return;
  }

  // Add XP to user (random 1-10)
  addXP(message.author.id, message.guildId);

  // Set cooldown (TTL in seconds)
  memoryCache.set(cacheKey, true, XP_COOLDOWN);
});

client.on('error', (error) => {
  console.error('[Bot] Error:', error);
});

client.on('shardError', (error) => {
  console.error('[Bot] Shard error:', error);
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
