import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leaderboardTool } from './leaderboard.ts';
import { toolDeclarations } from './index.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-leaderboard-tool-'));
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

// 12 players, p0 (rank 1) down to p11 (rank 12) — pushes p11 off the default first page.
function twelvePlayers(): unknown[] {
    return Array.from({ length: 12 }, (_, i) =>
        gameInstanceFixture(`p${i}`, String(1000 - i * 10)),
    );
}

describe('the tool registry', () => {
    it('declares get_leaderboard, which is what an adapter translates for its SDK', () => {
        expect(toolDeclarations.map((declaration) => declaration.name)).toContain(
            'get_leaderboard',
        );
    });
});

describe('leaderboardTool.execute', () => {
    it('reports an empty leaderboard rather than an empty list', async () => {
        const response = await leaderboardTool.execute({}, { guildId: 'g1' });

        expect(response).toBe('Aucun membre avec des coquillages pour le moment sur ce serveur.');
    });

    it('lists the top page in rank order', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const response = await leaderboardTool.execute({}, { guildId: 'g1' });

        expect(response).toContain('#1 <@p0>');
        expect(response).not.toContain('<@p11>');
    });

    it('appends a pinned member even when off the displayed page', async () => {
        await writeGameInstances('g1', twelvePlayers());

        const response = await leaderboardTool.execute({ user_id: 'p11' }, { guildId: 'g1' });

        expect(response).toContain('—\n**#12 <@p11>');
    });

    it('falls back to sort max and page 1 for invalid args instead of throwing', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('p0', '100')]);

        const response = await leaderboardTool.execute(
            { sort: 'not-a-real-sort', page: 'nope' },
            { guildId: 'g1' },
        );

        expect(response).toContain('tri : max');
        expect(response).toContain('page 1/');
    });
});
