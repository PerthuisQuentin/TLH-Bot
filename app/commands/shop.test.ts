import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { shopCommand } from './shop.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-shop-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

function gameInstanceFixture(userId: string, shells: string) {
    return {
        userId,
        resources: { shells },
        stats: { maxShells: shells },
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

async function readGameInstances(guildId: string): Promise<Array<Record<string, unknown>>> {
    const raw = await readFile(join(dir, `${guildId}-game-instances.json`), 'utf-8');
    return JSON.parse(raw) as Array<Record<string, unknown>>;
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

describe('shopCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await shopCommand.handler(mockReq({ member: { user: { id: 'u1' } } }), mock.res);

        expect(mock.payload?.data.content).toContain('serveur');
    });

    it('lists one field per upgrade when no upgrade option is given', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('🏪 Boutique');
        expect((embed.fields as unknown[]).length).toBe(3);
    });

    it('rejects an unknown upgrade id', async () => {
        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'upgrade', value: 'bogus' }] },
            }),
            mock.res,
        );

        expect(mock.payload?.data.content).toBe('Amélioration introuvable.');
    });

    it('reports insufficient funds and debits nothing', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'upgrade', value: 'divingOtters' }] },
            }),
            mock.res,
        );

        expect(mock.payload?.data.content).toContain('Fonds insuffisants');
        const [instance] = await readGameInstances('g1');
        expect((instance.resources as Record<string, string>).shells).toBe('0');
    });

    it('reports a quantity above the affordable maximum', async () => {
        // Level 0->1 costs 1000; not enough for 2 levels (1000 + 1200).
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1000')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: {
                    options: [
                        { name: 'upgrade', value: 'divingOtters' },
                        { name: 'quantity', value: 2 },
                    ],
                },
            }),
            mock.res,
        );

        expect(mock.payload?.data.content).toContain('Vous ne pouvez acheter que');
    });

    // Discord's min_value: 1 makes this unreachable in practice; the guard exists so a
    // malformed payload cannot reach buyUpgrade, where 0 used to be a free no-op purchase.
    it('rejects a non-positive quantity and debits nothing', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1000')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: {
                    options: [
                        { name: 'upgrade', value: 'divingOtters' },
                        { name: 'quantity', value: 0 },
                    ],
                },
            }),
            mock.res,
        );

        expect(mock.payload?.data.content).toContain('entier positif');
        const [instance] = await readGameInstances('g1');
        expect((instance.resources as Record<string, string>).shells).toBe('1000');
    });

    it('completes a purchase: debits the balance and increments the level, both on disk', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1000')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'upgrade', value: 'divingOtters' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('✅ Achat effectué');

        // No quantity option given: this also covers the default-to-1 behavior.
        const [instance] = await readGameInstances('g1');
        expect((instance.resources as Record<string, string>).shells).toBe('0');
        expect((instance.upgrades as Record<string, number>).divingOtters).toBe(1);
    });
});
