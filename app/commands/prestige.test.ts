import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { prestigeCommand } from './prestige.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-prestige-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

/** Unlocked by default: every case below is about the trade, not about reaching it. */
function fixture(runMaxShells: string, upgrades: Record<string, number> = {}) {
    return {
        userId: 'u1',
        resources: { shells: runMaxShells },
        stats: { maxShells: runMaxShells, runMaxShells, prestigeCount: 0 },
        income: { shells: '10' },
        growthRings: { days: 4, lastDate: '2026-09-15' },
        lastActiveAt: new Date(0).toISOString(),
        upgrades: { coralSeedling: 1, ...upgrades },
    };
}

async function seed(guildId: string, instance: unknown): Promise<void> {
    await writeFile(join(dir, `${guildId}-game-instances.json`), JSON.stringify([instance]));
}

async function readInstance(guildId: string): Promise<Record<string, never>> {
    const raw = await readFile(join(dir, `${guildId}-game-instances.json`), 'utf-8');
    return (JSON.parse(raw) as Record<string, never>[])[0];
}

function mockRes(): { res: Response; payload?: { type: number; data: Record<string, never> } } {
    const result: { res: Response; payload?: { type: number; data: Record<string, never> } } = {
        res: undefined as unknown as Response,
    };
    const res = {
        send: (payload: { type: number; data: Record<string, never> }) => {
            result.payload = payload;
            return res;
        },
    };
    result.res = res as unknown as Response;
    return result;
}

async function call(guildId: string, confirm?: boolean) {
    const mock = mockRes();
    await prestigeCommand.handler(
        {
            body: {
                guild_id: guildId,
                member: { user: { id: 'u1' } },
                data:
                    confirm === undefined
                        ? {}
                        : { options: [{ name: 'confirmer', value: confirm }] },
            },
        } as unknown as Request,
        mock.res,
    );
    return mock.payload?.data as unknown as {
        content?: string;
        embeds?: Array<{
            title: string;
            description: string;
            fields: Array<{ name: string; value: string }>;
        }>;
    };
}

describe('prestigeCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await prestigeCommand.handler(
            { body: { member: { user: { id: 'u1' } } } } as unknown as Request,
            mock.res,
        );

        expect((mock.payload?.data as unknown as { content: string }).content).toContain('serveur');
    });

    it('refuses below the first coral, naming what the run peak still misses', async () => {
        await seed('g1', fixture('500000'));

        const data = await call('g1');

        // A refusal is an embed like every other reply, so the command reads the same however
        // it answers.
        expect(data.embeds![0].description).toContain('500K 🐚');
        expect(data.content).toBeUndefined();
    });

    it('declines without naming coral while the seedling is unbought', async () => {
        await seed('g1', fixture('1e12', { coralSeedling: 0 }));

        for (const confirmed of [undefined, true]) {
            const data = await call('g1', confirmed);

            const embed = data.embeds![0];
            expect(embed.description).toContain('Bouture de corail');
            // Including the title: 🪸 there would name the currency the refusal is hiding.
            expect(JSON.stringify(embed)).not.toContain('🪸');
        }

        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '1e12' });
    });

    it('lists the Coquille millénaire among what is kept only once it is unlocked', async () => {
        await seed('g1', fixture('1e12'));
        expect(JSON.stringify((await call('g1')).embeds)).not.toContain('Coquille millénaire');

        // Another guild: the store keeps g1 in RAM, so rewriting its file would be ignored.
        await seed('g2', { ...fixture('1e12'), growthRings: { days: 100, lastDate: '' } });
        expect(JSON.stringify((await call('g2')).embeds)).toContain('Coquille millénaire');
    });

    it('previews the trade without touching anything', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40, nourishingReef: 2 }));

        const data = await call('g1');
        const embed = data.embeds![0];

        expect(embed.description).toContain('36 🪸');
        expect(embed.fields[0].value).toContain('🦦 Loutres plongeuses — niveau **40**');
        expect(embed.fields[1].value).toContain('🫧 Récif nourricier — niveau **2**');

        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '1e12' });
    });

    it('quotes the polyps multiplier, and says nothing about it at level 0', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40, buildingPolyps: 5 }));
        await seed('g2', fixture('1e12', { divingOtters: 40 }));

        const withPolyps = (await call('g1')).embeds![0].description;
        const without = (await call('g2')).embeds![0].description;

        expect(withPolyps).toContain('×1.61');
        expect(withPolyps).toContain('58 🪸');
        expect(without).not.toContain('polypes');
    });

    it('performs the trade on confirmation and writes it to disk', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40 }));

        const data = await call('g1', true);
        const embed = data.embeds![0];

        expect(embed.title).toBe('🪸 Prestige 1');
        expect(embed.description).toContain('36 🪸');

        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '0', coral: '36' });
        // maxShells survives, which is what protects roles and the leaderboard.
        expect(stored.stats).toEqual({
            maxShells: '1000000000000',
            runMaxShells: '0',
            prestigeCount: 1,
        });
        expect(stored.upgrades).toMatchObject({ divingOtters: 0 });
        expect(stored.growthRings).toEqual({ days: 4, lastDate: '2026-09-15' });
    });

    it('refuses a confirmation that cannot pay, debiting nothing', async () => {
        await seed('g1', fixture('500000', { divingOtters: 12 }));

        const data = await call('g1', true);

        expect(data.embeds![0].description).toContain('Il manque');
        const stored = await readInstance('g1');
        expect(stored.upgrades).toEqual({ coralSeedling: 1, divingOtters: 12 });
    });
});
