import { Client, GatewayIntentBits } from 'discord.js';
import { handleMessageShells } from './app/idle/shells.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('clientReady', () => {
    console.log(`[Bot] Logged in as ${client.user!.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    await handleMessageShells(message);
});

client.on('error', (error) => {
    console.error('[Bot] Error', error);
});

client.on('shardError', (error) => {
    console.error('[Bot] Shard error', error);
});

export async function startBot(): Promise<void> {
    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[Bot] Failed to login:', error);
        process.exit(1);
    }
}

export { client };
