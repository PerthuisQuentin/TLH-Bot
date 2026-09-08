import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type {
    Message,
    MessageReaction,
    PartialMessageReaction,
    PartialUser,
    User,
} from 'discord.js';
import { handleMessage, handleReaction } from './handlers.ts';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('clientReady', () => {
    console.log(`[Bot] Logged in as ${client.user!.tag}`);
});

// discord.js never awaits its listeners, so a rejection escaping one would be
// unhandled and kill the process along with the two other runtimes. Each listener
// is therefore a sync function handing off to an async one that swallows its own
// errors — never an async listener, which would hand the emitter a promise it drops.
async function onMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guild) return;
    try {
        await handleMessage(message);
    } catch (error) {
        console.error(`[Bot] Error handling message | messageId=${message.id}`, error);
    }
}

async function onReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
): Promise<void> {
    try {
        await handleReaction(reaction, user);
    } catch (error) {
        console.error(`[Bot] Error handling reaction | userId=${user.id}`, error);
    }
}

client.on('messageCreate', (message) => void onMessage(message));
client.on('messageReactionAdd', (reaction, user) => void onReaction(reaction, user));

client.on('error', (error) => {
    console.error('[Bot] Error', error);
});

client.on('shardError', (error) => {
    console.error('[Bot] Shard error', error);
});

/** Rejects on a failed login. `app.ts` owns what that means — it alone may exit. */
export async function startBot(): Promise<void> {
    await client.login(process.env.DISCORD_TOKEN);
}

export { client };
