import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDiscordEvent } from './handle-event.ts';
import { ChannelActivityType } from '../core/types.ts';
import { getGameInstance, flushGameInstances } from '../game-instance-storage.ts';
import { ResourceId } from '../core/types.ts';
import { JACKPOT_MULTIPLIER } from '../core/jackpot.ts';
import type { DiscordEvent } from '../../discord/types.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-handle-event-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

function makeEvent(
    overrides: Partial<DiscordEvent> & Pick<DiscordEvent, 'guildId' | 'channelId' | 'userId'>,
): DiscordEvent {
    return {
        channelName: 'general',
        activityType: ChannelActivityType.Message,
        displayName: 'Tester',
        currentRoleIds: [],
        ...overrides,
    };
}

async function writeConfig(guildId: string, config: unknown): Promise<void> {
    await writeFile(join(dir, `${guildId}-config.json`), JSON.stringify(config, null, 2));
}

function gameInstanceFixture(
    userId: string,
    overrides: Partial<{ shells: string; maxShells: string; income: string }> = {},
) {
    return {
        userId,
        resources: { shells: overrides.shells ?? '0' },
        stats: { maxShells: overrides.maxShells ?? '0' },
        income: { shells: overrides.income ?? '10' },
        streak: { value: 0, lastDate: '' },
        lastActiveAt: new Date(0).toISOString(),
        upgrades: {},
    };
}

async function writeGameInstances(guildId: string, instances: unknown[]): Promise<void> {
    await writeFile(
        join(dir, `${guildId}-game-instances.json`),
        JSON.stringify(instances, null, 2),
    );
}

describe('handleDiscordEvent — noShellChannels', () => {
    it('skips the channel entirely: no credit, no result', async () => {
        const guildId = 'g-noshell';
        const userId = 'u1';
        await writeConfig(guildId, { noShellChannels: ['c-ignored'] });
        await writeGameInstances(guildId, [gameInstanceFixture(userId, { shells: '500' })]);

        const result = await handleDiscordEvent(
            makeEvent({ guildId, userId, channelId: 'c-ignored' }),
        );

        expect(result).toEqual({});
        const instance = await getGameInstance(guildId, userId);
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('500');
    });
});

describe('handleDiscordEvent — cooldown', () => {
    it('blocks a second event from the same user within the cooldown window', async () => {
        const guildId = 'g-cooldown';
        const userId = 'u1';
        const event = makeEvent({ guildId, userId, channelId: 'c1' });

        const first = await handleDiscordEvent(event);
        expect(first.pendingRoleChanges).toBeDefined();
        await flushGameInstances(guildId);
        const shellsAfterFirst = (await getGameInstance(guildId, userId)).resources[
            ResourceId.SHELLS
        ];
        expect(shellsAfterFirst.gt(0)).toBe(true);

        const second = await handleDiscordEvent(event);
        expect(second).toEqual({});
        await flushGameInstances(guildId);
        const shellsAfterSecond = (await getGameInstance(guildId, userId)).resources[
            ResourceId.SHELLS
        ];
        expect(shellsAfterSecond.toString()).toBe(shellsAfterFirst.toString());
    });
});

describe('handleDiscordEvent — reaction crediting', () => {
    it('credits the reactor and the reacted message author, both positively', async () => {
        const guildId = 'g-credit';
        const reactorId = 'reactor1';
        const authorId = 'author1';
        // A high enough income that floor(income * 0.1 * variance roll) can never land
        // on exactly 0 — the default income of 10 makes that a real ~1/3 chance.
        await writeGameInstances(guildId, [
            gameInstanceFixture(reactorId, { income: '100' }),
            gameInstanceFixture(authorId, { income: '100' }),
        ]);

        await handleDiscordEvent(
            makeEvent({
                guildId,
                userId: reactorId,
                channelId: 'c1',
                activityType: ChannelActivityType.Reaction,
                messageAuthorId: authorId,
            }),
        );
        await flushGameInstances(guildId);

        const reactor = await getGameInstance(guildId, reactorId);
        const author = await getGameInstance(guildId, authorId);

        expect(reactor.resources[ResourceId.SHELLS].gt(0)).toBe(true);
        expect(author.resources[ResourceId.SHELLS].gt(0)).toBe(true);
    });
});

describe('handleDiscordEvent — jackpot', () => {
    it('reports a jackpot when the roll succeeds', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0); // < JACKPOT_CHANCE, always triggers

        const result = await handleDiscordEvent(
            makeEvent({ guildId: 'g-jackpot', userId: 'u1', channelId: 'c1' }),
        );

        expect(result.jackpot).toBeDefined();
        expect(result.jackpot?.multiplier).toBe(JACKPOT_MULTIPLIER);
        expect(result.jackpot?.amount.gt(0)).toBe(true);
    });
});

describe('handleDiscordEvent — role changes', () => {
    it('adds a role the player already qualifies for via maxShells', async () => {
        const guildId = 'g-roles';
        const userId = 'u1';
        await writeConfig(guildId, { shellsRoles: [{ roleId: 'r1', threshold: '50' }] });
        await writeGameInstances(guildId, [gameInstanceFixture(userId, { maxShells: '1000' })]);

        const result = await handleDiscordEvent(makeEvent({ guildId, userId, channelId: 'c1' }));

        expect(result.pendingRoleChanges?.addRoleId).toBe('r1');
    });
});
