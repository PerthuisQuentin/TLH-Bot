import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { deleteMessage } from './messages.ts';

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

function stubFetch(body: BodyInit | null, init: ResponseInit): void {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));
}

describe('deleteMessage', () => {
    it('rejects a missing channelId or messageId', async () => {
        const mock = mockRes();
        await deleteMessage(mockReq({ channelId: 'c1' }), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.body).toContain('channelId and messageId are required');
    });

    it('answers 200 when Discord accepts the delete', async () => {
        stubFetch(null, { status: 204 });

        const mock = mockRes();
        await deleteMessage(mockReq({ channelId: 'c1', messageId: 'm1' }), mock.res);

        expect(mock.status).toBe(200);
        expect(mock.body).toBe('Message deleted successfully');
    });

    // Used to answer a blanket 500: DiscordRequest throws on non-2xx, so the branch
    // that forwarded response.status was unreachable.
    it('forwards a Discord 404 rather than turning it into a 500', async () => {
        stubFetch(JSON.stringify({ message: 'Unknown Message', code: 10008 }), { status: 404 });

        const mock = mockRes();
        await deleteMessage(mockReq({ channelId: 'c1', messageId: 'nope' }), mock.res);

        expect(mock.status).toBe(404);
        expect(mock.body).toContain('Unknown Message');
    });

    it('forwards a Discord 403', async () => {
        stubFetch(JSON.stringify({ message: 'Missing Permissions' }), { status: 403 });

        const mock = mockRes();
        await deleteMessage(mockReq({ channelId: 'c1', messageId: 'm1' }), mock.res);

        expect(mock.status).toBe(403);
    });

    it('still answers 500 when the failure is not a Discord response', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

        const mock = mockRes();
        await deleteMessage(mockReq({ channelId: 'c1', messageId: 'm1' }), mock.res);

        expect(mock.status).toBe(500);
        expect(mock.body).toBe('Internal Server Error');
    });
});
