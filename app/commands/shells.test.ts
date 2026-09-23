import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';
import { shellsCommand } from './shells.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-shells-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

async function writeConfig(guildId: string, config: unknown): Promise<void> {
    await writeFile(join(dir, `${guildId}-config.json`), JSON.stringify(config, null, 2));
}

function gameInstanceFixture(
    userId: string,
    overrides: Partial<{
        shells: string;
        maxShells: string;
        income: string;
        upgrades: Record<string, number>;
    }> = {},
) {
    return {
        userId,
        resources: { shells: overrides.shells ?? '0' },
        stats: { maxShells: overrides.maxShells ?? '0' },
        income: { shells: overrides.income ?? '10' },
        growthRings: { days: 0, lastDate: '' },
        lastActiveAt: new Date(0).toISOString(),
        upgrades: overrides.upgrades ?? {},
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

describe('shellsCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await shellsCommand.handler(mockReq({ member: { user: { id: 'u1' } } }), mock.res);

        expect(mock.payload?.data.content).toContain('serveur');
        expect(mock.payload?.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);
    });

    it('shows a fresh player with no footer, no role, and "Non classé"', async () => {
        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = mock.payload?.data.embeds as Array<Record<string, unknown>>;
        expect(mock.payload?.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(embed[0].title).toBe('🐚 Profil Coquillages');
        expect(embed[0].description).toBe('<@u1>');
        expect(embed[0].footer).toBeUndefined();

        const fields = embed[0].fields as Array<{ name: string; value: string }>;
        // No Récif: a fresh player has not bought the seedling, so the layer does not exist
        // for them yet. The unlocked layout is covered further down.
        expect(fields.map((f) => f.name)).toEqual(['Rôles', 'Coquillages', 'Upgrades']);
        expect(fields[0].value).toContain('Non classé');
        expect(fields[0].value).toContain('Aucun');
    });

    it('hides the reef block entirely until the seedling is bought', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', { shells: '40000' })]);

        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const fields = embed.fields as Array<{ name: string; value: string }>;

        expect(fields.map((f) => f.name)).not.toContain('Récif');
        // Not just the block: the coral upgrades must not surface in the upgrade list either.
        const rendered = JSON.stringify(embed);
        expect(rendered).not.toContain('Récif nourricier');
        expect(rendered).not.toContain('Polypes');
        expect(rendered).not.toContain('🪸');
    });

    it('tells a player with no coral what the run peak still misses', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', {
                shells: '40000',
                maxShells: '40000',
                upgrades: { coralSeedling: 1 },
            }),
        ]);

        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const reef = (embed.fields as Array<{ name: string; value: string }>).find(
            (f) => f.name === 'Récif',
        );

        expect(reef?.value).toContain('Corail : 0 🪸');
        expect(reef?.value).toContain('Aucun prestige');
        // runMaxShells defaults to maxShells, so the gap is measured from 40K, not from 0.
        expect(reef?.value).toContain('Encore 960K 🐚');
    });

    it('shows the coral a prestige would pay once the run peak covers it', async () => {
        await writeGameInstances('g1', [
            {
                userId: 'u1',
                resources: { shells: '4.1e11', coral: '7' },
                stats: { maxShells: '9.2e12', runMaxShells: '2.5e12', prestigeCount: 3 },
                income: { shells: '52000000' },
                growthRings: { days: 0, lastDate: '' },
                lastActiveAt: new Date(0).toISOString(),
                upgrades: { coralSeedling: 1 },
            },
        ]);

        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const reef = (embed.fields as Array<{ name: string; value: string }>).find(
            (f) => f.name === 'Récif',
        );

        expect(reef?.value).toContain('Corail : 7 🪸');
        expect(reef?.value).toContain('Prestige 3');
        // Computed from runMaxShells (2.5e12), not from the all-time 9.2e12.
        expect(reef?.value).toContain('46 🪸');
    });

    it('keeps the one-shot seedling out of the upgrade list, bought or not', async () => {
        const cases: Array<Record<string, number>> = [{}, { coralSeedling: 1 }];

        for (const upgrades of cases) {
            await writeGameInstances('g1', [
                gameInstanceFixture('u1', { shells: '40000', maxShells: '40000', upgrades }),
            ]);

            const mock = mockRes();
            await shellsCommand.handler(
                mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
                mock.res,
            );

            const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
            const upgradeField = (embed.fields as Array<{ name: string; value: string }>).find(
                (f) => f.name === 'Upgrades',
            );

            expect(upgradeField?.value).not.toContain('Bouture');
            // The levelled ones are still all there: the filter is on one-shots, not on
            // everything the player happens to own.
            expect(upgradeField?.value).toContain('Loutres plongeuses');
            expect(upgradeField?.value).toContain('Nageoires hydrodynamiques');
            expect(upgradeField?.value).toContain('Sacs de récolte XXL');
        }
    });

    it('shows the "Max historique" footer once maxShells differs from the current balance', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { shells: '100', maxShells: '900' }),
        ]);

        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.footer).toEqual({ text: 'Max historique : 900 🐚' });
    });

    it('targets the user option instead of the caller when provided', async () => {
        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'caller' } },
                data: { options: [{ name: 'user', value: 'someone-else' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.description).toBe('<@someone-else>');
    });

    it('is ephemeral by default and public only when asked', async () => {
        const privateMock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            privateMock.res,
        );
        expect(privateMock.payload?.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);

        const publicMock = mockRes();
        await shellsCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'public', value: true }] },
            }),
            publicMock.res,
        );
        expect(publicMock.payload?.data.flags).toBeUndefined();
    });

    it('shows the currently held role once a threshold is reached', async () => {
        await writeConfig('g1', { shellsRoles: [{ roleId: 'role-1', threshold: '50' }] });
        await writeGameInstances('g1', [gameInstanceFixture('u1', { maxShells: '1000' })]);

        const mock = mockRes();
        await shellsCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        const fields = embed.fields as Array<{ name: string; value: string }>;
        expect(fields[0].value).toContain('<@&role-1>');
    });
});
