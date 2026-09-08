import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { leaderboardCommand } from './leaderboard.ts';

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
        income: { shells: '10' },
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

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

function mockRes(): { res: Response; payload?: { type: number; data: Record<string, unknown> } } {
    const result: { res: Response; payload?: { type: number; data: Record<string, unknown> } } = {
        res: undefined as unknown as Response,
    };
    const res = {
        send: (payload: { type: number; data: Record<string, unknown> }) => {
            result.payload = payload;
            return res;
        },
    };
    result.res = res as unknown as Response;
    return result;
}

// 12 players, p0 (rank 1, highest) down to p11 (rank 12, lowest) — enough to push
// someone off the default 10-entry first page.
function twelvePlayers(): unknown[] {
    return Array.from({ length: 12 }, (_, i) =>
        gameInstanceFixture(`p${i}`, String(1000 - i * 10)),
    );
}

describe('leaderboardCommand', () => {
    it('reports an empty leaderboard rather than an empty embed', async () => {
        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        expect(mock.payload?.data.content).toBe(
            'Aucun utilisateur avec des coquillages pour le moment.',
        );
    });

    it('bolds the requester line when they are on the displayed page', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'p0' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const description = embed.description as string;
        expect(description).toContain('**#1 <@p0>');
        expect(description).not.toContain('Non classé');
    });

    it('appends the requester separately when ranked but off the displayed page', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'p11' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const description = embed.description as string;
        expect(description).toContain('—\n**#12 <@p11>');
    });

    it('shows "Non classé" for a requester with no instance at all', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'never-played' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.description as string).toContain('Non classé • <@never-played>');
    });

    it('falls back to MAX for an invalid sort value', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('p0', '100')]);

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'p0' } },
                data: { options: [{ name: 'sort', value: 'not-a-real-sort' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect((embed.footer as { text: string }).text).toContain('tri : max');
    });

    it('falls back to page 1 for an invalid page number', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('p0', '100')]);

        const mock = mockRes();
        await leaderboardCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'p0' } },
                data: { options: [{ name: 'page', value: -5 }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect((embed.footer as { text: string }).text).toContain('Page 1/');
    });
});
