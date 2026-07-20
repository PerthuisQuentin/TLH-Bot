import { describe, it, expect, vi, afterEach } from 'vitest';
import { Collection } from 'discord.js';
import type { Request, Response } from 'express';
import { listRoles } from './guilds.ts';
import { client } from '../discord/setup.ts';

afterEach(() => {
    vi.restoreAllMocks();
});

function mockReq(params: Record<string, string>): Request {
    return { params } as unknown as Request;
}

function mockRes(): { res: Response; status?: number; contentType?: string; body?: unknown } {
    const result: { res: Response; status?: number; contentType?: string; body?: unknown } = {
        res: undefined as unknown as Response,
    };
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

describe('listRoles', () => {
    // Answering 400 rather than letting discord.js fail: a malformed id is the caller's
    // mistake, and the 500 it used to produce blamed this service for it.
    it.each(['../secret', 'a/b', 'guild id', 'x'.repeat(65)])(
        'rejects the malformed guildId %j without calling Discord',
        async (guildId) => {
            const fetchSpy = vi.spyOn(client.guilds, 'fetch');
            const mock = mockRes();

            await listRoles(mockReq({ guildId }), mock.res);

            expect(mock.status).toBe(400);
            expect(mock.body).toBe('Invalid guildId');
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('rejects a missing guildId', async () => {
        const mock = mockRes();
        await listRoles(mockReq({}), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.body).toBe('Missing guildId');
    });

    it('returns roles sorted by name', async () => {
        const roles = new Collection([
            ['r1', { id: 'r1', name: 'Zebra' }],
            ['r2', { id: 'r2', name: 'Alpha' }],
        ]);
        vi.spyOn(client.guilds, 'fetch').mockResolvedValue({
            roles: { fetch: vi.fn().mockResolvedValue(roles) },
        } as never);

        const mock = mockRes();
        await listRoles(mockReq({ guildId: 'g1' }), mock.res);

        expect(mock.contentType).toBe('application/json; charset=utf-8');
        expect(JSON.parse(mock.body as string)).toEqual({
            roles: [
                { id: 'r2', name: 'Alpha' },
                { id: 'r1', name: 'Zebra' },
            ],
        });
    });

    it('maps a Discord "unknown guild" error to 404', async () => {
        vi.spyOn(client.guilds, 'fetch').mockRejectedValue({ code: 10004 });

        const mock = mockRes();
        await listRoles(mockReq({ guildId: 'g1' }), mock.res);

        expect(mock.status).toBe(404);
        expect(mock.body).toBe('Guild not found');
    });

    it('maps any other error to 500', async () => {
        vi.spyOn(client.guilds, 'fetch').mockRejectedValue(new Error('network blip'));

        const mock = mockRes();
        await listRoles(mockReq({ guildId: 'g1' }), mock.res);

        expect(mock.status).toBe(500);
        expect(mock.body).toBe('Failed to list roles');
    });
});
