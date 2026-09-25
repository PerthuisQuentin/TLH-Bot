import { describe, it, expect } from 'vitest';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import type { Request, Response } from 'express';
import { handleInteraction } from './interactions.ts';

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

function mockRes(): {
    res: Response;
    sent?: unknown;
    status?: number;
    json?: unknown;
} {
    const result: { res: Response; sent?: unknown; status?: number; json?: unknown } = {
        res: undefined as unknown as Response,
    };
    const res = {
        send: (body: unknown) => {
            result.sent = body;
            return res;
        },
        status: (code: number) => {
            result.status = code;
            return res;
        },
        json: (body: unknown) => {
            result.json = body;
            return res;
        },
    };
    result.res = res as unknown as Response;
    return result;
}

describe('handleInteraction', () => {
    it('answers PING with PONG', async () => {
        const mock = mockRes();
        await handleInteraction(mockReq({ type: InteractionType.PING }), mock.res);

        expect(mock.sent).toEqual({ type: InteractionResponseType.PONG });
    });

    it('dispatches a known application command by name', async () => {
        const mock = mockRes();
        await handleInteraction(
            mockReq({ type: InteractionType.APPLICATION_COMMAND, data: { name: 'ping' } }),
            mock.res,
        );

        // Real pingCommand.handler ran: its own reply shape is already covered by
        // ping.test.ts, here we only care that dispatch actually reached it.
        expect(mock.sent).toMatchObject({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        });
    });

    it('rejects an unknown command name with 400', async () => {
        const mock = mockRes();
        await handleInteraction(
            mockReq({ type: InteractionType.APPLICATION_COMMAND, data: { name: 'not-a-command' } }),
            mock.res,
        );

        expect(mock.status).toBe(400);
        expect(mock.json).toEqual({ error: 'unknown command' });
    });

    it('routes a component click to the command named by its custom_id prefix', async () => {
        const mock = mockRes();
        await handleInteraction(
            mockReq({
                type: InteractionType.MESSAGE_COMPONENT,
                data: { custom_id: 'prestige:cancel' },
                guild_id: 'g1',
                member: { user: { id: 'u1' } },
            }),
            mock.res,
        );

        // Cancel touches no data: enough to prove the click reached prestige's own handler.
        expect(mock.sent).toMatchObject({ type: InteractionResponseType.UPDATE_MESSAGE });
    });

    it.each(['ping:anything', 'not-a-command:confirm', 'no-separator', ''])(
        'rejects a component the app cannot route (%j) with 400',
        async (customId) => {
            const mock = mockRes();
            await handleInteraction(
                mockReq({ type: InteractionType.MESSAGE_COMPONENT, data: { custom_id: customId } }),
                mock.res,
            );

            expect(mock.status).toBe(400);
            expect(mock.json).toEqual({ error: 'unknown component' });
        },
    );

    it('rejects an unknown interaction type with 400', async () => {
        const mock = mockRes();
        await handleInteraction(mockReq({ type: 999 }), mock.res);

        expect(mock.status).toBe(400);
        expect(mock.json).toEqual({ error: 'unknown interaction type' });
    });
});
