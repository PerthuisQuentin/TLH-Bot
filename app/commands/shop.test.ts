import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import { shopCommand } from './shop.ts';
import { mockRes, readPanel } from '../../test/discord-interaction.ts';

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

async function open() {
    const mock = mockRes();
    await shopCommand.handler(
        mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
        mock.res,
    );
    return { ...readPanel(mock.payload), content: mock.payload?.data.content };
}

async function click(action: string) {
    const mock = mockRes();
    await shopCommand.onComponent!(
        mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
        mock.res,
        action,
    );
    return { ...readPanel(mock.payload), status: mock.status };
}

type Reply = ReturnType<typeof readPanel>;

function title(reply: Reply): string | undefined {
    return reply.text.match(/^## (.+)$/m)?.[1];
}

/** The upgrades listed, by name, in order. */
function upgradeNames(reply: Reply): string[] {
    return [...reply.text.matchAll(/^### (.+) · niv\. \d+$/gm)].map((m) => m[1]);
}

function pageIds(reply: Reply): Array<string | undefined> {
    return reply.buttons.filter((b) => b.id?.startsWith('shop:page:')).map((b) => b.id);
}

function buyButtons(reply: Reply, upgradeId: string) {
    return reply.buttons.filter((b) => b.id?.startsWith(`shop:buy:${upgradeId}:`));
}

async function stored() {
    const [instance] = await readGameInstances('g1');
    return {
        shells: (instance.resources as Record<string, string>).shells,
        upgrades: instance.upgrades as Record<string, number>,
    };
}

describe('shopCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await shopCommand.handler(mockReq({ member: { user: { id: 'u1' } } }), mock.res);

        expect(mock.payload?.data.content).toContain('serveur');
    });

    it('opens privately on the shells page, listing only what shells can buy', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const reply = await open();

        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(title(reply)).toBe('🏪 Boutique — Coquillages');
        expect(upgradeNames(reply)).toEqual([
            '🦦 Loutres plongeuses',
            '🐟 Nageoires hydrodynamiques',
            '🎒 Sacs de récolte XXL',
        ]);
        // The seedling's aisle is the way in; the coral one gets no button until it is open.
        expect(pageIds(reply)).toEqual(['shop:page:shells', 'shop:page:treasures']);
        expect(reply.buttons.find((b) => b.id === 'shop:page:shells')?.disabled).toBe(true);
    });

    it('prices the three quantities on the buttons, greying out what the balance cannot cover', async () => {
        // Level 0->1 costs 1000, 1->2 costs 1200: 2500 covers two levels, not ten.
        await writeGameInstances('g1', [gameInstanceFixture('u1', '2500')]);

        const buttons = buyButtons(await open(), 'divingOtters');

        expect(buttons.map((b) => [b.id, b.disabled])).toEqual([
            ['shop:buy:divingOtters:1', false],
            ['shop:buy:divingOtters:10', true],
            ['shop:buy:divingOtters:max', false],
        ]);
        expect(buttons[0].label).toMatch(/^×1 · 1(\.00)?K 🐚$/);
        expect(buttons[2].label).toContain('Max · 2 niv.');
    });

    it('sells the seedling on the treasures page with a single button, against the shells balance', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '42')]);

        const reply = await click('page:treasures');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(title(reply)).toBe('🏪 Boutique — Trésors');
        expect(upgradeNames(reply)).toEqual(['🌱 Bouture de corail']);
        expect(reply.text).toContain('42 🐚');
        expect(buyButtons(reply, 'coralSeedling').map((b) => b.label)).toEqual([
            expect.stringMatching(/^Acheter · /),
        ]);
        expect(JSON.stringify(reply)).not.toContain('🪸');
    });

    it('offers the coral aisle once the seedling is bought', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        expect(pageIds(await open())).toContain('shop:page:coral');
    });

    it('drops the seedling from the shop entirely once it is owned', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const reply = await click('page:treasures');

        expect(upgradeNames(reply)).toEqual([]);
        expect(reply.text).toContain('Rien à vendre');
        expect(reply.text).not.toContain('Bouture');
    });

    it('sells the Coquille millénaire for coral on the treasures page once the rings reach the cap', async () => {
        const veteran = {
            ...gameInstanceFixture('u1', '0', UNLOCKED),
            resources: { shells: '0', coral: '20' },
            growthRings: { days: 100, lastDate: '' },
        };
        await writeGameInstances('g1', [veteran]);

        const reply = await click('page:treasures');

        expect(upgradeNames(reply)).toEqual(['🌀 Coquille millénaire']);
        expect(reply.text).toContain('20 🪸');
    });

    it('stops offering the treasures page once nothing is left on it', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        expect(pageIds(await open())).not.toContain('shop:page:treasures');
    });

    it('lands on the default page when the coral one is asked for while locked', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const reply = await click('page:coral');

        expect(title(reply)).toBe('🏪 Boutique — Coquillages');
        expect(JSON.stringify(reply)).not.toContain('🪸');
    });

    it('refuses to sell a coral upgrade while the layer is locked, without opening its aisle', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const reply = await click('buy:nourishingReef:1');

        expect(reply.text).toContain('❌');
        expect(reply.text).toContain('Bouture de corail');
        expect(title(reply)).toBe('🏪 Boutique — Coquillages');
        expect(JSON.stringify(reply)).not.toContain('🪸');
    });

    it('refuses a second seedling, since it is a one-shot purchase', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1e9', UNLOCKED)]);

        expect((await click('buy:coralSeedling:1')).text).toContain('niveau maximum');
    });

    it('shows the coral upgrades and the coral balance on the coral page', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const reply = await click('page:coral');

        expect(title(reply)).toBe('🏪 Boutique — Corail');
        expect(upgradeNames(reply)).toEqual(['🫧 Récif nourricier', '🪷 Polypes bâtisseurs']);
        expect(reply.text).toContain('🪸');
    });

    it('falls back to the default page when the value is not a page', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        expect(title(await click('page:bogus'))).toBe('🏪 Boutique — Coquillages');
    });

    it('refreshes the page in place', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const reply = await click('refresh:coral');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(title(reply)).toBe('🏪 Boutique — Corail');
    });

    it('opens a page in a new private message for a shortcut from another command', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0', UNLOCKED)]);

        const reply = await click('open:coral');

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(title(reply)).toBe('🏪 Boutique — Corail');
    });

    it.each(['buy:bogus:1', 'buy:divingOtters:5', 'buy:divingOtters', 'nope'])(
        'rejects an action it never drew (%s)',
        async (action) => {
            expect((await click(action)).status).toBe(400);
        },
    );

    it('reports insufficient funds in the banner and debits nothing', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '0')]);

        const reply = await click('buy:divingOtters:1');

        expect(reply.text).toContain('❌ Fonds insuffisants');
        expect((await stored()).shells).toBe('0');
    });

    it('refuses ten levels the balance cannot cover, rather than buying fewer', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1000')]);

        const reply = await click('buy:divingOtters:10');

        expect(reply.text).toContain('ne couvrent que **1** niveau');
        expect((await stored()).shells).toBe('1000');
    });

    it('completes a purchase: debits and levels up on disk, and redraws with the banner', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '1000')]);

        const reply = await click('buy:divingOtters:1');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.text).toContain('✅ 🦦 **Loutres plongeuses** : niv. 0 → **1**');
        expect(reply.text).toContain('### 🦦 Loutres plongeuses · niv. 1');
        const disk = await stored();
        expect(disk.shells).toBe('0');
        expect(disk.upgrades.divingOtters).toBe(1);
    });

    it('buys as many levels as the balance covers at click time on Max', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '2200')]);

        const reply = await click('buy:divingOtters:max');

        expect(reply.text).toContain('niv. 0 → **2**');
        const disk = await stored();
        expect(disk.shells).toBe('0');
        expect(disk.upgrades.divingOtters).toBe(2);
    });
});
