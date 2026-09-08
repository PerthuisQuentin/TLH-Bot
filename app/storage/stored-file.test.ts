import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStoredFile, TextStoredFile, type StoredFileTimings } from './stored-file.ts';

const TIMINGS: StoredFileTimings = { staleAfterMs: 60_000, flushDelayMs: 1000 };

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-stored-file-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

function jsonFile(name: string, timings: StoredFileTimings = TIMINGS): JsonStoredFile<string[]> {
    return new JsonStoredFile<string[]>(join(dir, name), timings, () => []);
}

describe('missing file', () => {
    it('JsonStoredFile falls back to the provided default', async () => {
        expect(await jsonFile('missing.json').read()).toEqual([]);
    });

    it('TextStoredFile rethrows ENOENT rather than defaulting', async () => {
        const file = new TextStoredFile(join(dir, 'missing.txt'), TIMINGS);
        await expect(file.read()).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('update / flush', () => {
    it('writes the mutated value to disk, JSON-serialized', async () => {
        const path = join(dir, 'data.json');
        const file = jsonFile('data.json');

        await file.update((v) => {
            v.push('a');
        });
        await file.flush();

        expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual(['a']);
    });

    it('is a no-op on a clean file, even after it has been read', async () => {
        const path = join(dir, 'untouched.json');
        const file = jsonFile('untouched.json');

        await file.read();
        await file.flush();

        await expect(readFile(path, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('leaves no .tmp file behind after a successful flush', async () => {
        const file = jsonFile('clean.json');
        await file.update((v) => v.push('x'));
        await file.flush();

        const entries = await readdir(dir);
        expect(entries.every((name) => !name.endsWith('.tmp'))).toBe(true);
    });

    it('keeps the change pending for retry when the write fails', async () => {
        // Parent directory does not exist, so the write is guaranteed to fail.
        const path = join(dir, 'missing-subdir', 'file.json');
        const file = new JsonStoredFile<string[]>(path, TIMINGS, () => []);

        await file.update((v) => v.push('x'));
        await expect(file.flush()).rejects.toThrow();

        expect(file.isDirty).toBe(true);
    });
});

describe('replace', () => {
    it('writes to disk immediately, bypassing the write-behind delay', async () => {
        const path = join(dir, 'replaced.json');
        const file = jsonFile('replaced.json');

        await file.replace(['immediate']);

        expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual(['immediate']);
    });
});

describe('write-behind delay', () => {
    it('flushes flushDelayMs after the first pending change, not a resetting debounce', async () => {
        const path = join(dir, 'delayed.json');
        const file = jsonFile('delayed.json', { staleAfterMs: 60_000, flushDelayMs: 150 });

        await file.update((v) => v.push('a')); // t ~ 0, schedules the flush for t ~ 150
        await sleep(75);
        await file.update((v) => v.push('b')); // t ~ 75, must not push the deadline out

        await sleep(50); // t ~ 125, still comfortably before the 150ms deadline
        await expect(readFile(path, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });

        await sleep(100); // t ~ 225, safely past it
        expect(JSON.parse(await readFile(path, 'utf-8'))).toEqual(['a', 'b']);
    });
});
