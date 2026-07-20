import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { FileStore, getFilePath, getFilesDirectory } from './file-store.ts';
import { AllowedFiles, type AllowedFile } from './types.ts';

describe('getFilePath', () => {
    it('throws on an invalid file type', () => {
        expect(() => getFilePath('g1', 'bogus' as AllowedFile)).toThrow();
    });

    it('throws when guildId is missing or empty', () => {
        expect(() => getFilePath('', AllowedFiles.CONFIG)).toThrow();
        expect(() => getFilePath(undefined as unknown as string, AllowedFiles.CONFIG)).toThrow();
    });

    // Express decodes %2F in a route param, so `req.params.guildId` really can carry
    // separators; without the allowlist `resolve` would happily climb out of files/.
    it('refuses a guildId that would escape the files directory', () => {
        for (const escape of [
            '../../../tmp/pwned',
            '..',
            'a/b',
            'a\\b',
            '.hidden',
            '/etc/passwd',
            'g1\0',
        ]) {
            expect(() => getFilePath(escape, AllowedFiles.CONFIG)).toThrow(/Invalid guildId/);
        }
    });

    it('accepts a snowflake, the dm pseudo-guild and test-style ids', () => {
        const dir = getFilesDirectory();
        for (const valid of ['593198902094856206', 'dm', 'g1', 'guild-1', 'g_2']) {
            expect(getFilePath(valid, AllowedFiles.CONFIG).startsWith(dir)).toBe(true);
        }
    });

    it('names JSON files with a .json extension', () => {
        expect(basename(getFilePath('g1', AllowedFiles.CONFIG))).toBe('g1-config.json');
    });

    it('names text files with a .txt extension', () => {
        expect(basename(getFilePath('g1', AllowedFiles.SYSTEM))).toBe('g1-system.txt');
    });
});

describe('FileStore', () => {
    let dir: string;
    let originalFilesDir: string | undefined;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'tlh-file-store-'));
        originalFilesDir = process.env.FILES_DIR;
        process.env.FILES_DIR = dir;
    });

    afterEach(async () => {
        if (originalFilesDir === undefined) delete process.env.FILES_DIR;
        else process.env.FILES_DIR = originalFilesDir;
        await rm(dir, { recursive: true, force: true });
    });

    it('round-trips a JSON file through updateJson then flush', async () => {
        const store = new FileStore();
        await store.updateJson('g1', AllowedFiles.CONFIG, (config) => {
            config.noAskChannels = ['c1'];
        });
        await store.flush('g1', AllowedFiles.CONFIG);

        const raw = await readFile(getFilePath('g1', AllowedFiles.CONFIG), 'utf-8');
        expect(JSON.parse(raw)).toEqual({ noAskChannels: ['c1'] });
    });

    it('writeJson writes to disk immediately, without a flush call', async () => {
        const store = new FileStore();
        await store.writeJson('g1', AllowedFiles.CONFIG, { noAskChannels: ['x'] });

        const raw = await readFile(getFilePath('g1', AllowedFiles.CONFIG), 'utf-8');
        expect(JSON.parse(raw)).toEqual({ noAskChannels: ['x'] });
    });

    it('readText/writeText round-trips a text file', async () => {
        const store = new FileStore();
        await store.writeText('g1', AllowedFiles.SYSTEM, 'You are a helpful bot.');
        expect(await store.readText('g1', AllowedFiles.SYSTEM)).toBe('You are a helpful bot.');
    });

    it('flush() on a file never accessed is a no-op, not a throw', async () => {
        const store = new FileStore();
        await expect(store.flush('g1', AllowedFiles.CONFIG)).resolves.toBeUndefined();
    });

    it('flushAll writes every dirty file at once, across guilds', async () => {
        const store = new FileStore();
        await store.updateJson('g1', AllowedFiles.CONFIG, (c) => {
            c.noAskChannels = ['a'];
        });
        await store.updateJson('g2', AllowedFiles.CONFIG, (c) => {
            c.noAskChannels = ['b'];
        });

        await store.flushAll();

        expect(JSON.parse(await readFile(getFilePath('g1', AllowedFiles.CONFIG), 'utf-8'))).toEqual(
            { noAskChannels: ['a'] },
        );
        expect(JSON.parse(await readFile(getFilePath('g2', AllowedFiles.CONFIG), 'utf-8'))).toEqual(
            { noAskChannels: ['b'] },
        );
    });
});
