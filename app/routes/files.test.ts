import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile as fsWriteFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { listFiles, getFile, writeFile } from './files.ts';
import { AllowedFiles } from '../storage/index.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-routes-files-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

function mockReq(params: Record<string, string> = {}, body?: unknown): Request {
    return { params, body } as unknown as Request;
}

type MockRes = { res: Response; status?: number; contentType?: string; body?: unknown };

function mockRes(): MockRes {
    const result: MockRes = { res: undefined as unknown as Response };
    const res = {
        status: (code: number) => {
            result.status = code;
            return res;
        },
        set: (_key: string, value: string) => {
            result.contentType = value;
            return res;
        },
        send: (body: unknown) => {
            result.body = body;
            return res;
        },
    };
    result.res = res as unknown as Response;
    return result;
}

describe('getFile', () => {
    it('rejects a missing guildId', async () => {
        const mock = mockRes();
        await getFile(mockReq({ fileType: AllowedFiles.CONFIG }), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Missing guildId');
    });

    // What Express hands over once it has decoded `..%2F..%2Ftmp%2Fpwned`.
    it('rejects a traversing guildId with 400 rather than reading outside files/', async () => {
        const mock = mockRes();
        await getFile(
            mockReq({ fileType: AllowedFiles.CONFIG, guildId: '../../../tmp/pwned' }),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Invalid guildId');
    });

    it('rejects an invalid fileType', async () => {
        const mock = mockRes();
        await getFile(mockReq({ fileType: 'bogus', guildId: 'g1' }), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.body).toContain('Invalid file type');
    });

    it('returns 500 when a text file does not exist yet (the real ENOENT path)', async () => {
        const mock = mockRes();
        await getFile(mockReq({ fileType: AllowedFiles.SYSTEM, guildId: 'g1' }), mock.res);

        expect(mock.status).toBe(500);
        expect(mock.body).toBe(`Failed to read ${AllowedFiles.SYSTEM} file`);
    });

    it('reads an existing text file as plain text', async () => {
        await fsWriteFile(join(dir, 'g1-system.txt'), 'You are a helpful bot.');

        const mock = mockRes();
        await getFile(mockReq({ fileType: AllowedFiles.SYSTEM, guildId: 'g1' }), mock.res);

        expect(mock.contentType).toBe('text/plain; charset=utf-8');
        expect(mock.body).toBe('You are a helpful bot.');
    });

    it('reads an existing JSON file, pretty-printed', async () => {
        await fsWriteFile(join(dir, 'g1-config.json'), JSON.stringify({ noAskChannels: ['c1'] }));

        const mock = mockRes();
        await getFile(mockReq({ fileType: AllowedFiles.CONFIG, guildId: 'g1' }), mock.res);

        expect(mock.contentType).toBe('application/json; charset=utf-8');
        expect(mock.body).toBe(JSON.stringify({ noAskChannels: ['c1'] }, null, 2));
    });
});

describe('writeFile', () => {
    it('rejects a missing guildId', async () => {
        const mock = mockRes();
        await writeFile(mockReq({ fileType: AllowedFiles.CONFIG }, {}), mock.res);

        expect(mock.status).toBe(400);
    });

    // The dangerous half: this one wrote attacker content outside files/.
    it('rejects a traversing guildId and writes nothing outside files/', async () => {
        const outside = join(dir, '..', 'pwned-system.txt');
        const mock = mockRes();
        await writeFile(
            mockReq(
                { fileType: AllowedFiles.SYSTEM, guildId: '../pwned' },
                'owned by the attacker',
            ),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Invalid guildId');
        await expect(readFile(outside, 'utf-8')).rejects.toThrow();
    });

    it('rejects an invalid fileType', async () => {
        const mock = mockRes();
        await writeFile(mockReq({ fileType: 'bogus', guildId: 'g1' }, {}), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.body).toContain('Invalid file type');
    });

    it('rejects a non-string body for a text file', async () => {
        const mock = mockRes();
        await writeFile(
            mockReq({ fileType: AllowedFiles.SYSTEM, guildId: 'g1' }, { not: 'a string' }),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Content must be plain text');
    });

    it('rejects a non-object body for a JSON file', async () => {
        const mock = mockRes();
        await writeFile(
            mockReq({ fileType: AllowedFiles.CONFIG, guildId: 'g1' }, 'not an object'),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Content must be valid JSON');
    });

    it('rejects a JSON body that fails schema validation', async () => {
        const mock = mockRes();
        await writeFile(
            mockReq(
                { fileType: AllowedFiles.CONFIG, guildId: 'g1' },
                { shellsRoles: 'not-an-array' },
            ),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.body).toContain('Invalid JSON content:');
    });

    it('writes a valid text file to disk', async () => {
        const mock = mockRes();
        await writeFile(
            mockReq({ fileType: AllowedFiles.SYSTEM, guildId: 'g1' }, 'hello system'),
            mock.res,
        );

        expect(mock.status).toBeUndefined();
        expect(await readFile(join(dir, 'g1-system.txt'), 'utf-8')).toBe('hello system');
    });

    it('writes a valid JSON file to disk', async () => {
        const mock = mockRes();
        await writeFile(
            mockReq({ fileType: AllowedFiles.CONFIG, guildId: 'g1' }, { noAskChannels: ['c1'] }),
            mock.res,
        );

        expect(mock.status).toBeUndefined();
        expect(JSON.parse(await readFile(join(dir, 'g1-config.json'), 'utf-8'))).toEqual({
            noAskChannels: ['c1'],
        });
    });
});

describe('listFiles', () => {
    it('lists files sorted, excluding subdirectories', async () => {
        await fsWriteFile(join(dir, 'b-file.txt'), '');
        await fsWriteFile(join(dir, 'a-file.txt'), '');
        await mkdir(join(dir, 'a-subdir'));

        const mock = mockRes();
        await listFiles(mockReq(), mock.res);

        expect(JSON.parse(mock.body as string)).toEqual({
            files: ['a-file.txt', 'b-file.txt'],
        });
    });
});
