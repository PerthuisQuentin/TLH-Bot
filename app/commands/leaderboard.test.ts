import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import { ComponentType } from 'discord-api-types/v10';
import { leaderboardCommand } from './leaderboard.ts';
import { mockRes, readPanel } from '../../test/discord-interaction.ts';
import { LeaderboardSort } from '../idle/leaderboard.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-leaderboard-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

function gameInstanceFixture(userId: string, maxShells: string) {
    return {
        userId,
        resources: { shells: maxShells },
        stats: { maxShells },
        growthRings: { days: 0, lastDate: '' },
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

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

async function open(guildId: string, userId: string) {
    const mock = mockRes();
    await leaderboardCommand.handler(
        mockReq({ guild_id: guildId, member: { user: { id: userId } } }),
        mock.res,
    );
    return readPanel(mock.payload);
}

async function click(
    action: string,
    { clicker = 'p0', values }: { clicker?: string; values?: string[] } = {},
) {
    const mock = mockRes();
    await leaderboardCommand.onComponent!(
        mockReq({
            guild_id: 'g1',
            member: { user: { id: clicker } },
            data: { custom_id: `leaderboard:${action}`, values },
        }),
        mock.res,
        action,
    );
    return { ...readPanel(mock.payload), status: mock.status };
}

/** The page row, the Share button of a private panel left aside. */
function navButtons<T extends { id?: string }>(reply: { buttons: T[] }): T[] {
    return reply.buttons.filter((b) => !b.id?.startsWith('leaderboard:share:'));
}

function shareId(reply: { buttons: Array<{ id?: string }> }) {
    return reply.buttons.find((b) => b.id?.startsWith('leaderboard:share:'))?.id;
}

/** The greyed-out middle button, which is where the page number now lives. */
function pageLabel(reply: { buttons: Array<{ label?: string; id?: string }> }) {
    return reply.buttons.find((b) => b.id?.startsWith('leaderboard:page:'))?.label;
}

// 12 players, p0 (rank 1, highest) down to p11 (rank 12, lowest) — enough to push
// someone off the default 10-entry first page.
function twelvePlayers(): unknown[] {
    return Array.from({ length: 12 }, (_, i) =>
        gameInstanceFixture(`p${i}`, String(1000 - i * 10)),
    );
}

describe('leaderboardCommand', () => {
    it('reports an empty leaderboard rather than an empty panel', async () => {
        const reply = await open('g1', 'u1');

        expect(reply.text).toBe('Aucun utilisateur avec des coquillages pour le moment.');
        expect(reply.buttons).toEqual([]);
    });

    it('opens on page 1 by record, private by default, pinging nobody', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await open('g1', 'p0');

        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(pageLabel(reply)).toBe('1/2');
        expect(reply.selected).toBe(LeaderboardSort.MAX);
        expect(shareId(reply)).toBe('leaderboard:share:max:1');
        expect(navButtons(reply)).toEqual([
            { label: '⏮', id: 'leaderboard:first:max:1', disabled: true },
            { label: '◀', id: 'leaderboard:prev:max:1', disabled: true },
            { label: '1/2', id: 'leaderboard:page:max:1', disabled: true },
            { label: '▶', id: 'leaderboard:next:max:2', disabled: false },
            { label: '⏭', id: 'leaderboard:last:max:2', disabled: false },
        ]);
    });

    it('leads with the sort select and ends with the arrows', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'p0' } } }),
            mock.res,
        );

        const layout = mock.payload?.data.components?.[0].components?.map((node) => [
            node.type,
            node.components?.[0]?.type,
        ]);
        expect(layout?.[0]).toEqual([ComponentType.ActionRow, ComponentType.StringSelect]);
        expect(layout?.at(-1)).toEqual([ComponentType.ActionRow, ComponentType.Button]);
    });

    it('shares the page it was on as a read-only snapshot, pinned to the sharer', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await click('share:max:2', { clicker: 'p10' });

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeFalsy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        // No select left to name the sort, so the title does.
        expect(reply.text).toContain('## 🏆 Classement par record historique');
        expect(reply.text).toContain('**#11 <@p10>');
        expect(reply.text).toContain('Page 2/2');
        expect(reply.text).toContain('partagé par <@p10>');
        expect(reply.buttons).toEqual([]);
        expect(reply.selected).toBeUndefined();
    });

    it('bolds the requester line when they are on the displayed page', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await open('g1', 'p0');

        expect(reply.text).toContain('**#1 <@p0>');
        expect(reply.text).not.toContain('Non classé');
    });

    it('appends the requester separately when ranked but off the displayed page', async () => {
        await writeGameInstances('g1', twelvePlayers());

        expect((await open('g1', 'p11')).text).toContain('—\n**#12 <@p11>');
    });

    it('shows "Non classé" for a requester with no instance at all', async () => {
        await writeGameInstances('g1', twelvePlayers());

        expect((await open('g1', 'never-played')).text).toContain('Non classé • <@never-played>');
    });

    it("rewrites the author's own message when they turn the page", async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await click('next:max:2');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(pageLabel(reply)).toBe('2/2');
        expect(reply.text).toContain('#11 <@p10>');
        expect(navButtons(reply)).toEqual([
            { label: '⏮', id: 'leaderboard:first:max:1', disabled: false },
            { label: '◀', id: 'leaderboard:prev:max:1', disabled: false },
            { label: '2/2', id: 'leaderboard:page:max:2', disabled: true },
            { label: '▶', id: 'leaderboard:next:max:2', disabled: true },
            { label: '⏭', id: 'leaderboard:last:max:2', disabled: true },
        ]);
    });

    it('jumps straight to either end, the arrows moving one page', async () => {
        await writeGameInstances(
            'g1',
            Array.from({ length: 31 }, (_, i) => gameInstanceFixture(`p${i}`, String(1000 - i))),
        );

        const onPage2 = await click('next:max:2');
        const ids = navButtons(onPage2).map((b) => b.id);

        expect(pageLabel(onPage2)).toBe('2/4');
        expect(ids).toEqual([
            'leaderboard:first:max:1',
            'leaderboard:prev:max:1',
            'leaderboard:page:max:2',
            'leaderboard:next:max:3',
            'leaderboard:last:max:4',
        ]);
        expect(pageLabel(await click('last:max:4'))).toBe('4/4');
    });

    it('keeps every page button distinct on a single page', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('p0', '100')]);

        const ids = navButtons(await open('g1', 'p0')).map((b) => b.id);

        expect(new Set(ids).size).toBe(5);
    });

    it('returns to page 1 on a new sort, carrying it into the arrows', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await click('sort', { values: [LeaderboardSort.CURRENT] });

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.selected).toBe(LeaderboardSort.CURRENT);
        expect(pageLabel(reply)).toBe('1/2');
        expect(navButtons(reply).map((b) => b.id)).toEqual([
            'leaderboard:first:current:1',
            'leaderboard:prev:current:1',
            'leaderboard:page:current:1',
            'leaderboard:next:current:2',
            'leaderboard:last:current:2',
        ]);
    });

    it('falls back to MAX and page 1 for a malformed custom_id', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const reply = await click('next:not-a-sort:-5');

        expect(reply.selected).toBe(LeaderboardSort.MAX);
        expect(pageLabel(reply)).toBe('1/2');
    });

    it('rejects an action it never drew', async () => {
        expect((await click('nope')).status).toBe(400);
    });
});
