import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, MessageReaction, User } from 'discord.js';
import { handleMessage, handleReaction } from './handlers.ts';
import { getGameInstance, flushGameInstances } from '../idle/game-instance-storage.ts';
import { ResourceId } from '../idle/core/types.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-handlers-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
    // Keeps rollJackpot() false, so the message path never reaches the
    // Gemini-calling branch inside handleEvent — nothing external to mock.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

function makeMessage(overrides: Record<string, unknown> = {}, send = vi.fn()): Message {
    return {
        guildId: 'g1',
        channelId: 'c1',
        content: 'hello world',
        author: { id: 'u1', username: 'alice', bot: false, globalName: null },
        member: null,
        mentions: { users: [] },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        channel: { name: 'general', send },
        ...overrides,
    } as unknown as Message;
}

describe('handleMessage', () => {
    it('credits the author and never touches the channel (no jackpot, no promotion)', async () => {
        const send = vi.fn();
        await handleMessage(makeMessage({}, send));
        await flushGameInstances('g1');

        const author = await getGameInstance('g1', 'u1');
        expect(author.resources[ResourceId.SHELLS].gt(0)).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });
});

function makeReactionFixture(overrides: { reactorBot?: boolean; messageGuildId?: string | null }) {
    const channelSend = vi.fn();
    const guildMembersFetch = vi.fn().mockResolvedValue({
        displayName: 'Carol',
        roles: { cache: [] },
    });
    const message = {
        partial: false,
        guildId: overrides.messageGuildId === undefined ? 'g1' : overrides.messageGuildId,
        channelId: 'c1',
        guild: overrides.messageGuildId === null ? null : { members: { fetch: guildMembersFetch } },
        author: { id: 'author1', username: 'bob', bot: false, globalName: null },
        channel: { name: 'general', send: channelSend },
        content: 'original message',
        mentions: { users: [] },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const reaction = { partial: false, message };
    const user = {
        partial: false,
        id: 'reactor1',
        username: 'carol',
        bot: overrides.reactorBot ?? false,
    };

    return {
        reaction: reaction as unknown as MessageReaction,
        user: user as unknown as User,
        channelSend,
    };
}

describe('handleReaction', () => {
    it('credits both the reactor and the reacted message author', async () => {
        const { reaction, user, channelSend } = makeReactionFixture({});

        await handleReaction(reaction, user);
        await flushGameInstances('g1');

        const reactor = await getGameInstance('g1', 'reactor1');
        const author = await getGameInstance('g1', 'author1');
        expect(reactor.resources[ResourceId.SHELLS].gt(0)).toBe(true);
        expect(author.resources[ResourceId.SHELLS].gt(0)).toBe(true);
        expect(channelSend).not.toHaveBeenCalled();
    });

    it('ignores a reaction from a bot', async () => {
        const { reaction, user } = makeReactionFixture({ reactorBot: true });

        await handleReaction(reaction, user);
        await flushGameInstances('g1');

        const reactor = await getGameInstance('g1', 'reactor1');
        expect(reactor.resources[ResourceId.SHELLS].toString()).toBe('0');
    });

    it('does nothing when the message has no guild', async () => {
        const { reaction, user } = makeReactionFixture({ messageGuildId: null });

        await expect(handleReaction(reaction, user)).resolves.toBeUndefined();
    });
});
