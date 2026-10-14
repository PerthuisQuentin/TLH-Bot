/**
 * One-shot: dumps every message the bot posted, in every channel and thread of every guild
 * it is in, to a JSON file. First step of the jackpot stats backfill: the announcements are
 * the only record of the jackpots won before `stats.jackpotCount` existed.
 *
 * Run with:
 *   tsx --env-file=.env.prod scripts/dump-bot-messages.ts
 *   tsx --env-file=.env.prod scripts/dump-bot-messages.ts --since=2026-06-17 --out=bot-messages.json
 *   tsx --env-file=.env.prod scripts/dump-bot-messages.ts --guild=<id>
 *
 * Read-only, over REST: no gateway login, so it runs next to the live bot without
 * disturbing it. `--since` defaults to the day the jackpot shipped (#58); `--out` defaults
 * to `bot-messages.json` at the project root, which is gitignored.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChannelType, DiscordAPIError, REST, Routes } from 'discord.js';
import type {
    APIGuildChannel,
    APIMessage,
    APIPartialGuild,
    APIThreadChannel,
    APIUser,
    RESTGetAPIChannelThreadsArchivedQuery,
    RESTGetAPIChannelUsersThreadsArchivedResult,
    RESTGetAPIGuildThreadsResult,
} from 'discord.js';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('DISCORD_TOKEN is not set. Run with --env-file=.env.prod (or .env.dev).');
    process.exit(1);
}

const since = new Date(flag('since') ?? '2026-06-17');
if (Number.isNaN(since.getTime())) {
    console.error(`Invalid --since: ${flag('since')}`);
    process.exit(1);
}
const out = resolve(flag('out') ?? 'bot-messages.json');
const onlyGuild = flag('guild');

const rest = new REST({ version: '10' }).setToken(token);

// ─── Discord ─────────────────────────────────────────────────────────────────

const DISCORD_EPOCH = 1420070400000n;

function snowflakeDate(id: string): Date {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

// Channels whose own timeline holds messages; forums and media only hold threads.
const MESSAGE_CHANNEL_TYPES = new Set<ChannelType>([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
]);

const THREAD_PARENT_TYPES = new Set<ChannelType>([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
]);

/** Missing Access / Missing Permissions: a channel the bot cannot read is skipped, not fatal. */
function isAccessError(error: unknown): boolean {
    return error instanceof DiscordAPIError && (error.code === 50001 || error.code === 50013);
}

/** Newest first, page by page, until the page reaches past `since`. */
async function fetchBotMessages(channelId: string, botId: string): Promise<APIMessage[]> {
    const found: APIMessage[] = [];
    let before: string | undefined;

    for (;;) {
        const query = new URLSearchParams({ limit: '100' });
        if (before) query.set('before', before);
        const page = (await rest.get(Routes.channelMessages(channelId), {
            query,
        })) as APIMessage[];
        if (page.length === 0) break;

        for (const message of page) {
            if (new Date(message.timestamp) < since) return found;
            if (message.author.id === botId) found.push(message);
        }
        before = page[page.length - 1].id;
    }

    return found;
}

/** Archived threads, most recently archived first; one archived before `since` ends the walk. */
async function fetchArchivedThreads(
    channelId: string,
    visibility: 'public' | 'private',
): Promise<APIThreadChannel[]> {
    const threads: APIThreadChannel[] = [];
    let before: string | undefined;

    for (;;) {
        const query: RESTGetAPIChannelThreadsArchivedQuery = { limit: 100 };
        if (before) query.before = before;
        const page = (await rest.get(Routes.channelThreads(channelId, visibility), {
            query: new URLSearchParams(query as Record<string, string>),
        })) as RESTGetAPIChannelUsersThreadsArchivedResult;

        for (const thread of page.threads as APIThreadChannel[]) {
            const archivedAt = thread.thread_metadata?.archive_timestamp;
            if (archivedAt && new Date(archivedAt) < since) return threads;
            threads.push(thread);
        }
        if (!page.has_more || page.threads.length === 0) break;
        before = (page.threads[page.threads.length - 1] as APIThreadChannel).thread_metadata
            ?.archive_timestamp;
        if (!before) break;
    }

    return threads;
}

async function listThreads(
    guildId: string,
    channels: APIGuildChannel[],
): Promise<APIThreadChannel[]> {
    const byId = new Map<string, APIThreadChannel>();
    const active = (await rest.get(
        Routes.guildActiveThreads(guildId),
    )) as RESTGetAPIGuildThreadsResult;
    for (const thread of active.threads as APIThreadChannel[]) byId.set(thread.id, thread);

    for (const channel of channels.filter((c) => THREAD_PARENT_TYPES.has(c.type))) {
        for (const visibility of ['public', 'private'] as const) {
            try {
                for (const thread of await fetchArchivedThreads(channel.id, visibility)) {
                    byId.set(thread.id, thread);
                }
            } catch (error) {
                if (!isAccessError(error)) throw error;
            }
        }
    }

    return [...byId.values()];
}

// ─── Dump ────────────────────────────────────────────────────────────────────

type DumpedMessage = {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
    messageId: string;
    createdAt: string;
    content: string;
};

const bot = (await rest.get(Routes.user())) as APIUser;
const guilds = ((await rest.get(Routes.userGuilds())) as APIPartialGuild[]).filter(
    (g) => !onlyGuild || g.id === onlyGuild,
);

console.error(
    `Bot ${bot.username} (${bot.id}), ${guilds.length} guild(s), since ${since.toISOString()}`,
);

const dumped: DumpedMessage[] = [];
const skipped: { guildId: string; channelId: string; channelName: string }[] = [];

for (const guild of guilds) {
    // The route only ever returns guild channels.
    const channels = (await rest.get(Routes.guildChannels(guild.id))) as APIGuildChannel[];
    const threads = await listThreads(guild.id, channels);
    const readable = [...channels.filter((c) => MESSAGE_CHANNEL_TYPES.has(c.type)), ...threads];

    console.error(`\n${guild.name}: ${readable.length} channel(s) and thread(s)`);

    for (const channel of readable) {
        const channelName = channel.name ?? channel.id;
        try {
            const messages = await fetchBotMessages(channel.id, bot.id);
            for (const message of messages) {
                dumped.push({
                    guildId: guild.id,
                    guildName: guild.name,
                    channelId: channel.id,
                    channelName,
                    messageId: message.id,
                    createdAt: snowflakeDate(message.id).toISOString(),
                    content: message.content,
                });
            }
            if (messages.length > 0) console.error(`  #${channelName}: ${messages.length}`);
        } catch (error) {
            if (!isAccessError(error)) throw error;
            skipped.push({ guildId: guild.id, channelId: channel.id, channelName });
            console.error(`  #${channelName}: no access, skipped`);
        }
    }
}

dumped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
writeFileSync(
    out,
    JSON.stringify(
        { botId: bot.id, since: since.toISOString(), skipped, messages: dumped },
        null,
        4,
    ),
);

console.error(`\n${dumped.length} message(s) written to ${out}`);
if (skipped.length > 0) console.error(`${skipped.length} channel(s) skipped for lack of access`);
