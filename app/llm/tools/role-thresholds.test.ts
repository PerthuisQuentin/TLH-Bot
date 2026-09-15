import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roleThresholdsTool } from './role-thresholds.ts';
import { toolDeclarations } from './index.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-role-thresholds-tool-'));
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

describe('the tool registry', () => {
    it('declares get_role_thresholds, which is what an adapter translates for its SDK', () => {
        expect(toolDeclarations.map((declaration) => declaration.name)).toContain(
            'get_role_thresholds',
        );
    });
});

describe('roleThresholdsTool.execute', () => {
    it('lists every configured role ascending by threshold, regardless of config order', async () => {
        await writeConfig('g1', {
            shellsRoles: [
                { roleId: 'gold', threshold: '10000' },
                { roleId: 'bronze', threshold: '500' },
            ],
        });

        const response = await roleThresholdsTool.execute({}, { guildId: 'g1' });

        expect(response.indexOf('bronze')).toBeLessThan(response.indexOf('gold'));
        expect(response).toContain('<@&bronze>');
        expect(response).toContain('<@&gold>');
    });

    it('reports no configured role rather than an empty list', async () => {
        await writeConfig('g1', {});

        const response = await roleThresholdsTool.execute({}, { guildId: 'g1' });

        expect(response).toBe("Aucun rôle Coquillages n'est configuré sur ce serveur.");
    });
});
