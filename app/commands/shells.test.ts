import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';
import { ComponentType } from 'discord-api-types/v10';
import { shellsCommand } from './shells.ts';
import { captureEdits, mockRes, readPanel } from '../../test/discord-interaction.ts';
import { renderOcean } from '../ocean/render.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-shells-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    vi.restoreAllMocks();
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
        stats: { maxShells: overrides.maxShells ?? '0', totalCoral: '0' },
        growthRings: { days: overrides.ringDays ?? 0, lastDate: '' },
        lastActiveAt: new Date(0).toISOString(),
        autoBuyEnabled: true,
        upgrades: overrides.upgrades ?? {},
    };
}

async function writeGameInstances(guildId: string, instances: unknown[]): Promise<void> {
    await writeFile(
        join(dir, `${guildId}-game-instances.json`),
        JSON.stringify(instances, null, 2),
    );
}

async function storedSwitch(userId: string): Promise<unknown> {
    const raw = await readFile(join(dir, 'g1-game-instances.json'), 'utf-8');
    const entries = JSON.parse(raw) as Array<{ userId: string; autoBuyEnabled: unknown }>;
    return entries.find((e) => e.userId === userId)?.autoBuyEnabled;
}

/** The Pieuvre intendante at level 1: the otters are automated. */
const AUTOMATED = { coralSeedling: 1, stewardOctopus: 1 };

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

const HASH = '0123456789abcdef0123456789abcdef';

/**
 * Runs a handler and reads the panel it drew. A panel goes out as an edit after a deferral,
 * so the panel is the edit and `type` is the deferral's; a refusal is the HTTP reply itself.
 */
async function answer(run: (res: ReturnType<typeof mockRes>['res']) => Promise<unknown>) {
    const mock = mockRes();
    const edits = captureEdits();
    await run(mock.res);
    const edit = edits.at(-1);
    const panel = edit ? { type: mock.payload!.type, data: edit.data } : mock.payload;
    return {
        ...readPanel(panel),
        deferralFlags: mock.payload?.data?.flags ?? 0,
        files: edit?.files ?? [],
        edits,
        content: mock.payload?.data?.content,
        status: mock.status,
    };
}

async function open(body: Record<string, unknown>) {
    return answer((res) =>
        shellsCommand.handler(mockReq({ guild_id: 'g1', token: 'tok', ...body }), res),
    );
}

async function openOwn(userId = 'u1') {
    return open({ member: { user: { id: userId } } });
}

async function click(action: string, body: Record<string, unknown> = {}) {
    return answer((res) =>
        shellsCommand.onComponent!(
            mockReq({ guild_id: 'g1', token: 'tok', member: { user: { id: 'u1' } }, ...body }),
            res,
            action,
        ),
    );
}

/** The text under one `### ` heading, up to the next. */
function block(text: string, heading: string): string | undefined {
    return text.split('### ').find((part) => part.startsWith(heading));
}

/** The text beside the avatar, above the first heading. */
function banner(text: string): string {
    return text.split('### ')[0];
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

        expect(reply.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.deferralFlags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.text).toContain('## 🐚 Profil Coquillages\n<@u1>');
        expect(reply.text).not.toContain('Max historique');
        // No coral line: a fresh player has not bought the seedling, so the layer does not exist
        // for them yet. The unlocked layout is covered further down.
        expect(headings(reply.text)).toEqual(['Ressources', 'Upgrades']);
        expect(block(reply.text, 'Ressources')).not.toContain('Corail');
        expect(block(reply.text, 'Ressources')).toMatch(/^🐚 \*\*0\*\* Coquillages - .+\/msg$/m);
        expect(banner(reply.text)).toContain('<@u1> · Aucun rôle · Non classé');
        expect(banner(reply.text)).toContain('Prochain rôle :');
        expect(banner(reply.text)).not.toContain('Automatisation');
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
            block((await openOwn(userId)).text, 'Ressources')!;

        expect(await coquillages('u1')).toContain('🌀 **42** Stries - ×1.42');
        expect(await coquillages('u1')).not.toContain('plafond');
        expect(await coquillages('u2')).toContain('🌀 **120** Stries - ×2.00 (plafond atteint)');

        const lifted = await coquillages('u3');
        expect(lifted).toContain('🌀 **120** Stries - ×2.20');
        expect(lifted).not.toContain('plafond');
    });

    it('hides every coral line until the seedling is bought', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', { shells: '40000' })]);

        const reply = await openOwn();

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

        const reef = block((await openOwn()).text, 'Ressources');

        // runMaxShells defaults to maxShells, so the gap is measured from 40K, not from 0.
        expect(reef).toContain('🪸 **0** Corail - prestige dans 960K 🐚');
        expect(reef).toContain('Aucun prestige');
    });

    it('shows the coral a prestige would pay once the run peak covers it', async () => {
        await writeGameInstances('g1', [
            {
                userId: 'u1',
                resources: { shells: '4.1e11', coral: '7' },
                stats: {
                    maxShells: '9.2e12',
                    runMaxShells: '2.5e12',
                    prestigeCount: 3,
                    totalCoral: '0',
                },
                growthRings: { days: 0, lastDate: '' },
                lastActiveAt: new Date(0).toISOString(),
                autoBuyEnabled: true,
                upgrades: { coralSeedling: 1 },
            },
        ]);

        const reef = block((await openOwn()).text, 'Ressources');

        // Computed from runMaxShells (2.5e12), not from the all-time 9.2e12.
        expect(reef).toContain('🪸 **7** Corail - +46 au prestige');
        expect(reef).toContain('Prestige 3');
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

    it('lists the Pieuvre intendante while it has levels left', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { upgrades: { coralSeedling: 1, stewardOctopus: 2 } }),
        ]);

        expect(block((await openOwn()).text, 'Upgrades')).toContain('Pieuvre intendante');
    });

    it('drops the Pieuvre intendante from the upgrade list once maxed', async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { upgrades: { coralSeedling: 1, stewardOctopus: 3 } }),
        ]);

        const upgrades = block((await openOwn()).text, 'Upgrades');
        expect(upgrades).not.toContain('Pieuvre intendante');
        expect(upgrades).toContain('Loutres plongeuses');
    });

    describe('automation', () => {
        const AUTO_OFF = 'shells:auto-off:u1:';

        it('shows the switch in the banner once the Pieuvre is bought', async () => {
            await writeGameInstances('g1', [gameInstanceFixture('u1', { upgrades: AUTOMATED })]);

            expect(banner((await openOwn()).text)).toContain('🐙 Automatisation : **activée**');
        });

        it('says nothing of it, and offers no switch, before the first level', async () => {
            const reply = await openOwn();

            expect(reply.text).not.toContain('Automatisation');
            expect(reply.buttons.some((b) => b.id?.startsWith('shells:auto-'))).toBe(false);
        });

        it('offers the switch on your own profile only', async () => {
            await writeGameInstances('g1', [gameInstanceFixture('u1', { upgrades: AUTOMATED })]);

            const own = (await openOwn('u1')).buttons;
            // u2 looking at u1's profile through the select.
            const other = (
                await click('view', { member: { user: { id: 'u2' } }, data: { values: ['u1'] } })
            ).buttons;

            expect(own.find((b) => b.id?.startsWith(AUTO_OFF))?.label).toBe(
                '🐙 Couper l’automatisation',
            );
            expect(other.some((b) => b.id?.startsWith('shells:auto-'))).toBe(false);
        });

        it('switches it off in place, on disk before the redraw, and offers to switch it back on', async () => {
            await writeGameInstances('g1', [gameInstanceFixture('u1', { upgrades: AUTOMATED })]);

            const reply = await click(`auto-off:u1:u${HASH}`);

            expect(reply.type).toBe(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);
            expect(banner(reply.text)).toContain('Automatisation : **désactivée**');
            expect(reply.buttons.map((b) => b.id)).toContain(`shells:auto-on:u1:u${HASH}`);
            expect(await storedSwitch('u1')).toBe(false);
        });

        it("refuses to change someone else's", async () => {
            await writeGameInstances('g1', [
                gameInstanceFixture('u1', { upgrades: AUTOMATED }),
                gameInstanceFixture('u2', { upgrades: AUTOMATED }),
            ]);

            const mock = mockRes();
            await shellsCommand.onComponent!(
                mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
                mock.res,
                `auto-off:u2:u${HASH}`,
            );

            expect(mock.payload?.data.content).toContain('votre propre automatisation');
            expect(await storedSwitch('u2')).toBe(true);
        });

        it('refuses without the Pieuvre, naming nothing behind the seedling', async () => {
            await writeGameInstances('g1', [gameInstanceFixture('u1')]);

            const mock = mockRes();
            await shellsCommand.onComponent!(
                mockReq({ guild_id: 'g1', member: { user: { id: 'u1' } } }),
                mock.res,
                `auto-off:u1:u${HASH}`,
            );

            const content = mock.payload?.data.content ?? '';
            expect(content).toContain('rien à automatiser');
            expect(content).not.toMatch(/Pieuvre|corail|🪸/i);
            expect(await storedSwitch('u1')).toBe(true);
        });
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

    it('offers share, the profile select and the navigation row, carrying the avatar in the ids', async () => {
        const reply = await open({ member: { user: { id: 'u1', avatar: HASH } } });

        expect(reply.buttons.map((b) => b.id)).toEqual([
            `shells:share:u1:u${HASH}`,
            `shells:refresh:u1:u${HASH}`,
            'shells:open',
            'shop:open:shells',
        ]);
        expect(reply.buttons.find((b) => b.id === 'shells:open')?.disabled).toBe(true);
        expect(reply.selects).toEqual(['shells:view']);
    });

    it("leaves 👤 Profil live on someone else's profile, to lead back to your own", async () => {
        // u2 looking at u1's profile through the select.
        const reply = await click('view', {
            member: { user: { id: 'u2' } },
            data: { values: ['u1'] },
        });

        expect(reply.buttons.find((b) => b.id === 'shells:open')?.disabled).toBe(false);
        expect(reply.buttons.map((b) => b.id)).toContain('shop:open:shells');
    });

    it("offers 🪸 Prestige by the viewer's reef, not the profile's", async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', { upgrades: { coralSeedling: 1 } }),
            gameInstanceFixture('u2'),
        ]);
        const view = async (viewer: string, target: string) =>
            (
                await click('view', {
                    member: { user: { id: viewer } },
                    data: { values: [target] },
                })
            ).buttons.map((b) => b.id);

        expect((await openOwn('u1')).buttons.map((b) => b.id)).toContain('prestige:open');
        expect(await view('u2', 'u1')).not.toContain('prestige:open');
        expect(await view('u1', 'u2')).toContain('prestige:open');
    });

    it("navigates back to the clicker's own profile in place", async () => {
        const reply = await click('open', { member: { user: { id: 'u2', avatar: HASH } } });

        expect(reply.type).toBe(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);
        expect(reply.text).toContain('<@u2>');
        expect(reply.thumbnail).toBe(`https://cdn.discordapp.com/avatars/u2/${HASH}.png?size=128`);
    });

    it('refreshes the profile in place, keeping the avatar from its id', async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u2', { shells: '1234' })]);

        const reply = await click(`refresh:u2:u${HASH}`);

        expect(reply.type).toBe(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);
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

        expect(reply.type).toBe(InteractionResponseType.DEFERRED_UPDATE_MESSAGE);
        expect(reply.text).toContain('<@u7>');
        expect(reply.thumbnail).toBe(
            `https://cdn.discordapp.com/guilds/g1/users/u7/avatars/${HASH}.png?size=128`,
        );
    });

    it('shares a read-only snapshot, naming the sharer and pinging nobody', async () => {
        const reply = await click(`share:u2:u${HASH}`);

        expect(reply.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.deferralFlags & InteractionResponseFlags.EPHEMERAL).toBeFalsy();
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

    describe('ocean', () => {
        it('draws it between the banner and the resources, from the profile shown', async () => {
            await writeGameInstances('g1', [
                gameInstanceFixture('u1', { shells: '266242', upgrades: { divingOtters: 12 } }),
            ]);

            const reply = await openOwn();

            expect(reply.gallery).toEqual(['attachment://ocean.png']);
            expect(reply.layout?.slice(0, 3)).toEqual([
                ComponentType.Section,
                ComponentType.MediaGallery,
                ComponentType.Separator,
            ]);
            expect(reply.files.map((f) => [f.name, f.type])).toEqual([['ocean.png', 'image/png']]);
            // 12 otters and 266K shells: otters 3 and shells 3, see app/idle/ocean-levels.ts.
            const expected = renderOcean({ otters: 3, shells: 3 });
            expect(Buffer.from(await reply.files[0].arrayBuffer()).equals(expected)).toBe(true);
        });

        it('carries it on every redraw and on the shared copy', async () => {
            for (const action of [`refresh:u1:u${HASH}`, 'open', `share:u1:u${HASH}`]) {
                const reply = await click(action);
                expect(reply.gallery, action).toEqual(['attachment://ocean.png']);
                expect(
                    reply.files.map((f) => f.name),
                    action,
                ).toEqual(['ocean.png']);
            }
        });

        it('edits the deferred reply of the interaction, attaching exactly the new picture', async () => {
            const reply = await click(`refresh:u1:u${HASH}`);

            expect(reply.edits).toHaveLength(1);
            expect(reply.edits[0].url).toMatch(/\/webhooks\/[^/]+\/tok\/messages\/@original$/);
            expect(reply.edits[0].data).toMatchObject({
                attachments: [{ id: 0, filename: 'ocean.png' }],
            });
        });

        it('falls back to an error text in the same reply when the edit fails', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const fetchSpy = vi
                .spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(null, { status: 500 }))
                .mockResolvedValue(new Response('{}', { status: 200 }));

            await shellsCommand.handler(
                mockReq({ guild_id: 'g1', token: 'tok', member: { user: { id: 'u1' } } }),
                mockRes().res,
            );

            expect(fetchSpy).toHaveBeenCalledTimes(2);
            const fallback = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string) as {
                components: Array<{ content: string }>;
            };
            expect(fallback.components[0].content).toContain('Une erreur est survenue');
        });
    });

    it('shows the currently held role once a threshold is reached', async () => {
        await writeConfig('g1', { shellsRoles: [{ roleId: 'role-1', threshold: '50' }] });
        await writeGameInstances('g1', [gameInstanceFixture('u1', { maxShells: '1000' })]);

        expect(banner((await openOwn()).text)).toContain('<@u1> · <@&role-1> · #1');
    });
});
