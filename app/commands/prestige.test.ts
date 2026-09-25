import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import { prestigeCommand } from './prestige.ts';
import { mockRes, readPanel } from '../../test/discord-interaction.ts';

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

const body = (guildId: string) => ({ guild_id: guildId, member: { user: { id: 'u1' } } });

async function preview(guildId: string) {
    const mock = mockRes();
    await prestigeCommand.handler({ body: body(guildId) } as unknown as Request, mock.res);
    return readPanel(mock.payload);
}

async function click(guildId: string, action: string) {
    const mock = mockRes();
    await prestigeCommand.onComponent!(
        { body: body(guildId) } as unknown as Request,
        mock.res,
        action,
    );
    return { ...readPanel(mock.payload), status: mock.status };
}

describe('prestigeCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await prestigeCommand.handler(
            { body: { member: { user: { id: 'u1' } } } } as unknown as Request,
            mock.res,
        );

        expect(mock.payload?.data.content).toContain('serveur');
    });

    it('refuses below the first coral, naming what the run peak still misses', async () => {
        await seed('g1', fixture('500000'));

        const reply = await preview('g1');

        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.text).toContain('500K 🐚');
        expect(reply.buttons).toEqual([]);
    });

    it('declines without naming coral while the seedling is unbought', async () => {
        await seed('g1', fixture('1e12', { coralSeedling: 0 }));

        for (const reply of [await preview('g1'), await click('g1', 'confirm')]) {
            expect(reply.text).toContain('Bouture de corail');
            // Including the title: 🪸 there would name the currency the refusal is hiding.
            expect(reply.text).not.toContain('🪸');
            expect(reply.buttons).toEqual([]);
        }

        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '1e12' });
    });

    it('lists the Coquille millénaire among what is kept only once it is unlocked', async () => {
        await seed('g1', fixture('1e12'));
        expect((await preview('g1')).text).not.toContain('Coquille millénaire');

        // Another guild: the store keeps g1 in RAM, so rewriting its file would be ignored.
        await seed('g2', { ...fixture('1e12'), growthRings: { days: 100, lastDate: '' } });
        expect((await preview('g2')).text).toContain('Coquille millénaire');
    });

    it('previews the trade with its two buttons, without touching anything', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40, nourishingReef: 2 }));

        const reply = await preview('g1');

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.text).toContain('36 🪸');
        expect(reply.text).toMatch(/perdez[\s\S]*🦦 Loutres plongeuses — niveau \*\*40\*\*/);
        expect(reply.text).toMatch(/gardez[\s\S]*🫧 Récif nourricier — niveau \*\*2\*\*/);
        expect(reply.buttons.map((b) => b.id)).toEqual(['prestige:confirm', 'prestige:cancel']);

        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '1e12' });
    });

    it('quotes the polyps multiplier, and says nothing about it at level 0', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40, buildingPolyps: 5 }));
        await seed('g2', fixture('1e12', { divingOtters: 40 }));

        const withPolyps = (await preview('g1')).text;
        const without = (await preview('g2')).text;

        expect(withPolyps).toContain('×1.61');
        expect(withPolyps).toContain('58 🪸');
        expect(without).not.toContain('polypes');
    });

    it('performs the trade on the confirm click, rewrites the preview and writes to disk', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40 }));

        const reply = await click('g1', 'confirm');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.text).toContain('🪸 Prestige 1');
        expect(reply.text).toContain('36 🪸');
        // Confirm and cancel are gone; only the result's Share is left, carrying what it reports.
        expect(reply.buttons.map((b) => b.id)).toEqual(['prestige:share:1:36']);

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

    it('refuses a second confirm click, the run peak being already spent', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40 }));

        await click('g1', 'confirm');
        const again = await click('g1', 'confirm');

        expect(again.text).toContain('Il manque');
        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '0', coral: '36' });
    });

    it('refuses a confirmation that cannot pay, debiting nothing', async () => {
        await seed('g1', fixture('500000', { divingOtters: 12 }));

        const reply = await click('g1', 'confirm');

        expect(reply.text).toContain('Il manque');
        const stored = await readInstance('g1');
        expect(stored.upgrades).toEqual({ coralSeedling: 1, divingOtters: 12 });
    });

    it('cancels by rewriting the preview, changing nothing', async () => {
        await seed('g1', fixture('1e12', { divingOtters: 40 }));

        const reply = await click('g1', 'cancel');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.text).toContain('annulé');
        expect(reply.buttons).toEqual([]);
        const stored = await readInstance('g1');
        expect(stored.resources).toEqual({ shells: '1e12' });
    });

    it('shares the event publicly, without the private balances', async () => {
        const reply = await click('g1', 'share:1:36');

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeFalsy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.text).toContain('<@u1> a fait son **Prestige 1**');
        expect(reply.text).toContain('**36 🪸**');
        expect(reply.text).not.toContain('Loutres');
        expect(reply.buttons).toEqual([]);
    });

    it.each(['share:0:36', 'share:1:not-a-number', 'share:1', 'nope'])(
        'rejects an action it never drew (%s)',
        async (action) => {
            expect((await click('g1', action)).status).toBe(400);
        },
    );
});
