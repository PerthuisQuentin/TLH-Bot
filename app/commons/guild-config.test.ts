import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGuildConfigOrNull } from './guild-config.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-guild-config-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

describe('readGuildConfigOrNull', () => {
    it('returns the stored config', async () => {
        await writeFile(join(dir, 'g1-config.json'), JSON.stringify({ noAskChannels: ['c1'] }));

        expect(await readGuildConfigOrNull('g1')).toEqual({ noAskChannels: ['c1'] });
    });

    // The distinction the callers' fail-closed branch rests on: no config is a valid
    // state meaning "nothing excluded", an unreadable one is not.
    it('returns the empty default for a guild with no config file at all', async () => {
        expect(await readGuildConfigOrNull('g-none')).toEqual({});
    });

    it('returns null on a malformed file rather than an empty config', async () => {
        await writeFile(join(dir, 'g-broken-config.json'), '{ this is not json');
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await readGuildConfigOrNull('g-broken')).toBeNull();
        expect(logged).toHaveBeenCalled();
    });
});
