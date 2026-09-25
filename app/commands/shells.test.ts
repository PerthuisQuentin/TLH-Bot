import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';
import { shellsCommand } from './shells.ts';
import { prestigeCommand } from './prestige.ts';
import { mockRes, readPanel } from '../../test/discord-interaction.ts';

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
        upgrades: Record<string, number>;
        ringDays: number;
    }> = {},
) {
    return {
        userId,
        resources: { shells: overrides.shells ?? '0' },
        stats: { maxShells: overrides.maxShells ?? '0' },
        growthRings: { days: overrides.ringDays ?? 0, lastDate: '' },
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

const HASH = '0123456789abcdef0123456789abcdef';

async function open(body: Record<string, unknown>) {
    const mock = mockRes();
    await shellsCommand.handler(mockReq({ guild_id: 'g1', ...body }), mock.res);
    return { ...readPanel(mock.payload), content: mock.payload?.data.content };
}

async function openOwn(userId = 'u1') {
    return open({ member: { user: { id: userId } } });
}

async function click(action: string, body: Record<string, unknown> = {}) {
    const mock = mockRes();
    await shellsCommand.onComponent!(
        mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } }, ...body }),
        mock.res,
        action,
    );
    return { ...readPanel(mock.payload), status: mock.status };
}

/** The text under one `### ` heading, up to the next. */
function block(text: string, heading: string): string | undefined {
    return text.split('### ').find((part) => part.startsWith(heading));
}

function headings(text: string): string[] {
    return [...text.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
}

describe('shellsCommand', () => {
    it('rejects a missing guild_id', async () => {
        const mock = mockRes();
        await shellsCommand.handler(mockReq({ member: { user: { id: 'u1' } } }), mock.res);

        expect(mock.payload?.data.content).toContain('serveur');
        expect(mock.payload?.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);
    });

    it('shows a fresh player privately, with no record line, no role, and "Non classé"', async () => {
        const reply = await openOwn();

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.text).toContain('## 🐚 Profil Coquillages\n<@u1>');
        expect(reply.text).not.toContain('Max historique');
        // No Récif: a fresh player has not bought the seedling, so the layer does not exist
        // for them yet. The unlocked layout is covered further down.
        expect(headings(reply.text)).toEqual(['Rôles', 'Coquillages', 'Upgrades']);
        expect(block(reply.text, 'Rôles')).toContain('Non classé');
        expect(block(reply.text, 'Rôles')).toContain('Aucun');
    });

    it('shows the growth rings, the cap, and the bonus past it once lifted', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { ringDays: 42 }),
            gameInstanceFixture('u2', { ringDays: 120 }),
            gameInstanceFixture('u3', {
                ringDays: 120,
                upgrades: { coralSeedling: 1, millennialShell: 1 },
            }),
        ]);

        const coquillages = async (userId: string) =>
            block((await openOwn(userId)).text, 'Coquillages')!;

        expect(await coquillages('u1')).toContain('🌀 Stries de croissance : 42 jours — ×1.42');
        expect(await coquillages('u1')).not.toContain('plafond');
        expect(await coquillages('u2')).toContain('120 jours — ×2.00 (plafond atteint)');

        const lifted = await coquillages('u3');
        expect(lifted).toContain('120 jours — ×2.20');
        expect(lifted).not.toContain('plafond');
    });

    it('hides the reef block entirely until the seedling is bought', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', { shells: '40000' })]);

        const reply = await openOwn();

        expect(headings(reply.text)).not.toContain('Récif');
        // Not just the block: the coral upgrades must not surface in the upgrade list either.
        expect(reply.text).not.toContain('Récif nourricier');
        expect(reply.text).not.toContain('Polypes');
        expect(reply.text).not.toContain('🪸');
        expect(reply.buttons.map((b) => b.id)).not.toContain('prestige:open');
    });

    it('tells a player with no coral what the run peak still misses', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', {
                shells: '40000',
                maxShells: '40000',
                upgrades: { coralSeedling: 1 },
            }),
        ]);

        const reef = block((await openOwn()).text, 'Récif');

        expect(reef).toContain('Corail : 0 🪸');
        expect(reef).toContain('Aucun prestige');
        // runMaxShells defaults to maxShells, so the gap is measured from 40K, not from 0.
        expect(reef).toContain('Encore 960K 🐚');
    });

    it('shows the coral a prestige would pay once the run peak covers it', async () => {
        await writeGameInstances('g1', [
            {
                userId: 'u1',
                resources: { shells: '4.1e11', coral: '7' },
                stats: { maxShells: '9.2e12', runMaxShells: '2.5e12', prestigeCount: 3 },
                growthRings: { days: 0, lastDate: '' },
                lastActiveAt: new Date(0).toISOString(),
                upgrades: { coralSeedling: 1 },
            },
        ]);

        const reef = block((await openOwn()).text, 'Récif');

        expect(reef).toContain('Corail : 7 🪸');
        expect(reef).toContain('Prestige 3');
        // Computed from runMaxShells (2.5e12), not from the all-time 9.2e12.
        expect(reef).toContain('46 🪸');
    });

    it('keeps the one-shot seedling out of the upgrade list, bought or not', async () => {
        const cases: Array<Record<string, number>> = [{}, { coralSeedling: 1 }];

        for (const upgrades of cases) {
            await writeGameInstances('g1', [
                gameInstanceFixture('u1', { shells: '40000', maxShells: '40000', upgrades }),
            ]);

            const upgradeBlock = block((await openOwn()).text, 'Upgrades');

            expect(upgradeBlock).not.toContain('Bouture');
            // The levelled ones are still all there: the filter is on one-shots, not on
            // everything the player happens to own.
            expect(upgradeBlock).toContain('Loutres plongeuses');
            expect(upgradeBlock).toContain('Nageoires hydrodynamiques');
            expect(upgradeBlock).toContain('Sacs de récolte XXL');
        }
    });

    it('shows the all-time record on the small line once it differs from the balance', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { shells: '100', maxShells: '900' }),
        ]);

        expect((await openOwn()).text).toContain('-# Max historique : 900 🐚 · mis à jour <t:');
    });

    it("shows the caller's server avatar over their account one", async () => {
        const reply = await open({ member: { avatar: HASH, user: { id: 'u1', avatar: 'x' } } });

        expect(reply.thumbnail).toBe(
            `https://cdn.discordapp.com/guilds/g1/users/u1/avatars/${HASH}.png?size=128`,
        );
    });

    it('offers refresh, share and the profile select, carrying the avatar in the ids', async () => {
        const reply = await open({ member: { user: { id: 'u1', avatar: HASH } } });

        expect(reply.buttons.map((b) => b.id)).toEqual([
            `shells:share:u1:u${HASH}`,
            `shells:refresh:u1:u${HASH}`,
            'shop:open:shells',
        ]);
        expect(reply.selects).toEqual(['shells:view']);
    });

    it('offers the shop shortcut on your own profile only', async () => {
        const ownIds = (await openOwn('u1')).buttons.map((b) => b.id);
        // u2 looking at u1's profile through the select.
        const otherIds = (
            await click('view', { member: { user: { id: 'u2' } }, data: { values: ['u1'] } })
        ).buttons.map((b) => b.id);

        expect(ownIds).toContain('shop:open:shells');
        expect(otherIds).not.toContain('shop:open:shells');
    });

    it('offers the prestige shortcut on your own profile only, once the reef is open', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { upgrades: { coralSeedling: 1 } }),
        ]);

        const ownIds = (await openOwn('u1')).buttons.map((b) => b.id);
        // u2 looking at u1's profile through the select.
        const otherIds = (
            await click('view', { member: { user: { id: 'u2' } }, data: { values: ['u1'] } })
        ).buttons.map((b) => b.id);

        expect(ownIds).toContain('prestige:open');
        expect(otherIds).not.toContain('prestige:open');
    });

    it('opens the prestige preview in a new private message from the shortcut', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { upgrades: { coralSeedling: 1 } }),
        ]);

        const mock = mockRes();
        await prestigeCommand.onComponent!(
            mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
            mock.res,
            'open',
        );
        const reply = readPanel(mock.payload);

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.text).toContain('Prestige');
    });

    it('refreshes the profile in place, keeping the avatar from its id', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u2', { shells: '1234' })]);

        const reply = await click(`refresh:u2:u${HASH}`);

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.text).toContain('<@u2>');
        expect(reply.text).toContain('1.23K');
        expect(reply.thumbnail).toBe(`https://cdn.discordapp.com/avatars/u2/${HASH}.png?size=128`);
    });

    it('switches to the profile picked in the select, avatar resolved by Discord', async () => {
        const reply = await click('view', {
            data: {
                values: ['u7'],
                resolved: { users: { u7: { avatar: null } }, members: { u7: { avatar: HASH } } },
            },
        });

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.text).toContain('<@u7>');
        expect(reply.thumbnail).toBe(
            `https://cdn.discordapp.com/guilds/g1/users/u7/avatars/${HASH}.png?size=128`,
        );
    });

    it('shares a read-only snapshot, naming the sharer and pinging nobody', async () => {
        const reply = await click(`share:u2:u${HASH}`);

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeFalsy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.text).toContain('<@u2>');
        expect(reply.text).toContain('partagé par <@u1>');
        expect(reply.thumbnail).toBe(`https://cdn.discordapp.com/avatars/u2/${HASH}.png?size=128`);
        expect(reply.buttons).toEqual([]);
        expect(reply.selects).toEqual([]);
    });

    it.each(['refresh', 'share:', 'view', 'nope'])(
        'rejects an action it cannot act on (%s)',
        async (action) => {
            expect((await click(action)).status).toBe(400);
        },
    );

    it('shows the currently held role once a threshold is reached', async () => {
        await writeConfig('g1', { shellsRoles: [{ roleId: 'role-1', threshold: '50' }] });
        await writeGameInstances('g1', [gameInstanceFixture('u1', { maxShells: '1000' })]);

        expect(block((await openOwn()).text, 'Rôles')).toContain('<@&role-1>');
    });
});
