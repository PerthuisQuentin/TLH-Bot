import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection } from 'discord.js';
import type { Chat } from '@google/genai';
import type { Message } from 'discord.js';
import { genai } from '../gemini/gemini.ts';
import type { GuildConfig } from '../commons/types.ts';
import { maybeChatNaturally } from './chat.ts';

const GUILD_ID = 'g-chat';
const BOT_ID = 'bot1';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-chat-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
    await writeFile(join(dir, `${GUILD_ID}-system.txt`), 'Tu es un bot de test.');
    await writeFile(join(dir, `${GUILD_ID}-memory.txt`), 'Rien pour le moment.');
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

async function writeConfig(config: GuildConfig): Promise<void> {
    await writeFile(join(dir, `${GUILD_ID}-config.json`), JSON.stringify(config));
}

/** Stands in for the model; the returned mock also carries the prompt it was sent. */
function fakeGemini(text = 'Salut à tous !'): ReturnType<typeof vi.fn> {
    const sendMessage = vi.fn(() => Promise.resolve({ text }));
    vi.spyOn(genai.chats, 'create').mockReturnValue({ sendMessage } as unknown as Chat);
    return sendMessage;
}

type MessageOverrides = {
    content?: string;
    mentionsBot?: boolean;
    member?: { displayName: string } | null;
    globalName?: string | null;
    /** Contents of the messages `channel.messages.fetch` returns, newest last. */
    history?: string[];
};

/** Shaped like what parseMessage reads off a fetched history message. */
function historyMessage(content: string, index: number) {
    return {
        author: { id: `h${index}`, username: `user${index}`, bot: false, globalName: null },
        member: { displayName: `User ${index}` },
        content,
        mentions: { users: new Collection() },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
}

function makeMessage({
    content = 'salut tout le monde',
    mentionsBot = false,
    member = { displayName: 'Alice' },
    globalName = null,
    history = [],
}: MessageOverrides) {
    const reply = vi.fn();
    const mentioned = new Collection<string, { id: string; username: string }>();
    if (mentionsBot) mentioned.set(BOT_ID, { id: BOT_ID, username: 'gerard' });

    // fetch() hands back newest-first, which chat.ts reverses.
    const fetched = new Collection<string, unknown>();
    [...history]
        .reverse()
        .forEach((text, index) => fetched.set(`h${index}`, historyMessage(text, index)));

    const message = {
        id: 'm1',
        guildId: GUILD_ID,
        channelId: 'c1',
        content,
        author: { id: 'u1', username: 'alice', bot: false, globalName },
        member,
        mentions: { users: mentioned },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        client: { user: { id: BOT_ID } },
        channel: {
            name: 'general',
            messages: { fetch: vi.fn(() => Promise.resolve(fetched)) },
        },
        reply,
    };

    return { message: message as unknown as Message, reply };
}

describe('maybeChatNaturally, triggers', () => {
    it('always answers a direct mention, whatever the probability rolls say', async () => {
        // Rolls high enough that neither the indirect nor the random gate could fire.
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        await writeConfig({ chatNicknames: ['gégé'] });
        fakeGemini('Oui ?');
        const { message, reply } = makeMessage({ mentionsBot: true });

        await maybeChatNaturally(message, 'general');

        expect(reply).toHaveBeenCalledWith('Oui ?');
    });

    it('answers an indirect mention when the roll lands under the configured probability', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.05);
        await writeConfig({ chatNicknames: ['gégé'], chatIndirectProbability: 0.1 });
        fakeGemini('On parle de moi ?');
        const { message, reply } = makeMessage({ content: 'vous avez vu Gégé hier ?' });

        await maybeChatNaturally(message, 'general');

        expect(reply).toHaveBeenCalledWith('On parle de moi ?');
    });

    it('stays quiet on an indirect mention when the roll lands over the probability', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        await writeConfig({ chatNicknames: ['gégé'], chatIndirectProbability: 0.1 });
        fakeGemini();
        const { message, reply } = makeMessage({ content: 'vous avez vu Gégé hier ?' });

        await maybeChatNaturally(message, 'general');

        expect(reply).not.toHaveBeenCalled();
    });

    it('answers a plain message when the random roll lands under the probability', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.005);
        await writeConfig({ chatRandomProbability: 0.01 });
        fakeGemini('Je passais par là.');
        const { message, reply } = makeMessage({});

        await maybeChatNaturally(message, 'general');

        expect(reply).toHaveBeenCalledWith('Je passais par là.');
    });

    it('stays quiet on a plain message when the random roll lands over the probability', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        await writeConfig({ chatRandomProbability: 0.01 });
        fakeGemini();
        const { message, reply } = makeMessage({});

        await maybeChatNaturally(message, 'general');

        expect(reply).not.toHaveBeenCalled();
    });
});

// The header used to print CONTEXT_MESSAGES_LIMIT, so it claimed 50 whatever the prompt
// actually carried — and this path appends the trigger message on top of the fetched
// window, which made 51 the normal case.
describe('maybeChatNaturally, the history the model is given', () => {
    it('announces the number of messages the prompt actually carries', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        await writeConfig({});
        const sendMessage = fakeGemini('Vu.');
        const { message } = makeMessage({
            mentionsBot: true,
            content: 'et donc @gerard ?',
            history: ['premier', 'deuxième'],
        });

        await maybeChatNaturally(message, 'general');

        const prompt = (sendMessage.mock.calls[0][0] as { message: string }).message;
        // Two fetched messages plus the trigger message appended after them.
        expect(prompt).toContain('HISTORIQUE DES 3 DERNIERS MESSAGES');
        expect(prompt).toContain('premier');
        expect(prompt).toContain('deuxième');
        expect(prompt).toContain('et donc @gerard ?');
    });
});

describe('maybeChatNaturally, the name the model is given', () => {
    // parseMessage falls back to the global name for a member with no server nickname,
    // so the instruction has to as well: naming the same person two different ways in
    // one prompt reads to the model as two people.
    it('names a nickname-less author by their global name, as the history does', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        await writeConfig({});
        const sendMessage = fakeGemini('Coucou.');
        const { message } = makeMessage({
            mentionsBot: true,
            member: null,
            globalName: 'AliceGlobale',
        });

        await maybeChatNaturally(message, 'general');

        const prompt = sendMessage.mock.calls[0][0] as { message: string };
        expect(prompt.message).toContain('AliceGlobale vient de te mentionner');
        expect(prompt.message).not.toContain('alice vient de te mentionner');
    });
});

// Both gates run before the trigger is even rolled, so a direct mention — the one input
// that always fires — is what proves they actually suppress rather than merely lower it.
describe('maybeChatNaturally, guild gates', () => {
    it('never answers when chatEnabled is false', async () => {
        await writeConfig({ chatEnabled: false });
        fakeGemini();
        const { message, reply } = makeMessage({ mentionsBot: true });

        await maybeChatNaturally(message, 'general');

        expect(reply).not.toHaveBeenCalled();
    });

    // Fail closed: a config that cannot be parsed must not be read as an empty one, or a
    // syntax error would silently unlock every channel the file was meant to exclude.
    it('never answers when the config file is malformed', async () => {
        await writeFile(join(dir, `${GUILD_ID}-config.json`), '{ this is not json');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fakeGemini();
        const { message, reply } = makeMessage({ mentionsBot: true });

        await maybeChatNaturally(message, 'general');

        expect(reply).not.toHaveBeenCalled();
    });

    it('never answers in a channel listed in noChatChannels', async () => {
        await writeConfig({ noChatChannels: ['c1'] });
        fakeGemini();
        const { message, reply } = makeMessage({ mentionsBot: true });

        await maybeChatNaturally(message, 'general');

        expect(reply).not.toHaveBeenCalled();
    });
});
