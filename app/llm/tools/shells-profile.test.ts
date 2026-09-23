import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellsProfileTool } from './shells-profile.ts';
import { toolDeclarations } from './index.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-shells-profile-tool-'));
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
        growthRings: { days: 3, lastDate: '2020-01-01' },
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

describe('the tool registry', () => {
    it('declares get_shells_profile, which is what an adapter translates for its SDK', () => {
        expect(toolDeclarations.map((declaration) => declaration.name)).toContain(
            'get_shells_profile',
        );
    });
});

describe('shellsProfileTool.execute', () => {
    it("renders the target user's balance, rank and growth rings, not the caller's", async () => {
        await writeGameInstances('g1', [
            gameInstanceFixture('u1', '100'),
            gameInstanceFixture('u2', '500'),
        ]);

        const response = await shellsProfileTool.execute({ user_id: 'u2' }, { guildId: 'g1' });

        expect(response).toContain('<@u2>');
        expect(response).toContain('500');
        expect(response).not.toContain('<@u1>');
    });

    it("includes /shop pricing so the model can advise on a member's next purchase", async () => {
        await writeGameInstances('g1', [gameInstanceFixture('u1', '100000')]);

        const response = await shellsProfileTool.execute({ user_id: 'u1' }, { guildId: 'g1' });

        expect(response).toContain('Boutique');
        expect(response).toContain('prochain niveau');
        expect(response).toContain('achetable dès maintenant');
    });

    it('reports a missing user_id to the model rather than throwing', async () => {
        const response = await shellsProfileTool.execute({}, { guildId: 'g1' });

        expect(response).toBe("Erreur: aucun identifiant d'utilisateur fourni.");
    });
});
