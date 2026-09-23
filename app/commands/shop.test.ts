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

function gameInstanceFixture(
    userId: string,
    shells: string,
    upgrades: Record<string, number> = {},
) {
    return {
        userId,
        resources: { shells },
        stats: { maxShells: shells },
        income: { shells: '10' },
        growthRings: { days: 0, lastDate: '' },
        lastActiveAt: new Date(0).toISOString(),
        upgrades,
    };
}

/** Coral exists for this player: the seedling is what opens the aisle. */
const UNLOCKED = { coralSeedling: 1 };

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

    it('defaults to the shells page, listing only what shells can buy', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('🏪 Boutique — Coquillages');
        expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).toEqual([
            '🦦 Loutres plongeuses',
            '🐟 Nageoires hydrodynamiques',
            '🎒 Sacs de récolte XXL',
        ]);
        // The seedling's aisle is the way in; the coral one is not advertised until it is open.
        expect(embed.description).toContain('/shop page:Trésors');
        expect(embed.description).not.toContain('/shop page:Corail');
    });

    it('sells the seedling on the treasures page, against the shells balance', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '42')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'page', value: 'treasures' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('🏪 Boutique — Trésors');
        expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).toEqual([
            '🌱 Bouture de corail',
        ]);
        expect(embed.description).toContain('42 🐚');
        expect(JSON.stringify(embed)).not.toContain('🪸');
    });

    it('points at the coral aisle once the seedling is bought', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.description).toContain('/shop page:Corail');
    });

    it('drops the seedling from the shop entirely once it is owned', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'page', value: 'treasures' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.fields).toEqual([]);
        expect(embed.description).toContain('Rien à vendre');
        // Not just out of the fields: nothing is left of it anywhere on the page.
        expect(JSON.stringify(embed)).not.toContain('Bouture');
    });

    it('stops advertising the treasures page once nothing is left on it', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.description).not.toContain('Trésors');
    });

    it('seals the coral page until the seedling is bought, naming the way in', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'page', value: 'coral' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.fields).toBeUndefined();
        expect(embed.description).toContain('Bouture de corail');
        expect(embed.description).toContain('/shop page:Trésors');
        // The prices and the currency itself stay behind the door.
        expect(JSON.stringify(embed)).not.toContain('🪸');
    });

    it('refuses to sell a coral upgrade by name while the layer is locked', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'upgrade', value: 'nourishingReef' }] },
            }),
            mock.res,
        );

        const content = mock.payload?.data.content as string;
        expect(content).toContain('Bouture de corail');
        expect(content).not.toContain('🪸');
    });

    it('refuses a second seedling, since it is a one-shot purchase', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1e9', UNLOCKED)]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'upgrade', value: 'coralSeedling' }] },
            }),
            mock.res,
        );

        expect(mock.payload?.data.content).toContain('niveau maximum');
    });

    it('shows the coral upgrades and the coral balance on the coral page', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'page', value: 'coral' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('🏪 Boutique — Corail');
        expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).toEqual([
            '🫧 Récif nourricier',
            '🪷 Polypes bâtisseurs',
        ]);
        expect(embed.description).toContain('🪸');
    });

    it('falls back to the default page when the value is not a page', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const mock = mockRes();
        await shopCommand.handler(
            mockReq({
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
                data: { options: [{ name: 'page', value: 'bogus' }] },
            }),
            mock.res,
        );

        const embed = (mock.payload?.data.embeds as Array<Record<string, unknown>>)[0];
        expect(embed.title).toBe('🏪 Boutique — Coquillages');
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
