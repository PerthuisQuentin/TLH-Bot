import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { InteractionResponseFlags } from 'discord-interactions';
import { heatCommand } from './heat.ts';
import { updateChannelHeat } from '../idle/core/heat/channel-activity.ts';
import { ChannelActivityType } from '../idle/core/types.ts';

afterEach(() => {
    vi.useRealTimers();
});

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

function mockRes(): { res: Response; payload?: { type: number; data: Record<string, unknown> } } {
    const result: { res: Response; payload?: { type: number; data: Record<string, unknown> } } = {
        res: undefined as unknown as Response,
    };
    const res = {
        send: (payload: { type: number; data: Record<string, unknown> }) => {
            result.payload = payload;
            return res;
        },
    };
    result.res = res as unknown as Response;
    return result;
}

describe('heatCommand', () => {
    it('rejects a missing channel_id', async () => {
        const mock = mockRes();
        await heatCommand.handler(mockReq({}), mock.res);

        expect(mock.payload?.data.content).toBe('Impossible de déterminer le canal.');
    });

    it('shows "no recent activity" for a channel that was never touched', async () => {
        const mock = mockRes();
        await heatCommand.handler(mockReq({ channel_id: 'chan-untouched' }), mock.res);

        const embed = mock.payload?.data.embeds as Array<Record<string, unknown>>;
        expect(embed[0].description).toBe('*Aucune activité récente.*');
        expect(embed[0].fields).toBeUndefined();
        expect(embed[0].color).toBe(0x2ecc71); // green: multiplier stays x1.0
    });

    it('shows the bar (not "no activity") once a single contributor exists, still green', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        updateChannelHeat('chan-solo', 'u1', ChannelActivityType.Message);

        const mock = mockRes();
        await heatCommand.handler(mockReq({ channel_id: 'chan-solo' }), mock.res);

        const embed = mock.payload?.data.embeds as Array<Record<string, unknown>>;
        expect(embed[0].description).not.toBe('*Aucune activité récente.*');
        expect(embed[0].description).toContain('1');
        expect(embed[0].color).toBe(0x2ecc71);
    });

    it('lists contributors with their share of the total, and bumps the color tier', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        // Two messages each (contribution 0.5 -> 1.0) so heat = (2^2 - 1 - 1) / 2 = 1,
        // just enough to cross the x1.2 threshold (>= 0.5).
        updateChannelHeat('chan-duo', 'u1', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u1', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u2', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u2', ChannelActivityType.Message);

        const mock = mockRes();
        await heatCommand.handler(mockReq({ channel_id: 'chan-duo' }), mock.res);

        const embed = mock.payload?.data.embeds as Array<Record<string, unknown>>;
        const field = (embed[0].fields as Array<{ name: string; value: string }>)[0];
        expect(field.name).toBe('Participants actifs');
        expect(field.value).toContain('<@u1>');
        expect(field.value).toContain('<@u2>');
        expect(field.value).toContain('50%');
        expect(embed[0].color).toBe(0xf1c40f); // heat 1.0 -> x1.2 tier
    });

    it('reaches the top color tier once heat crosses 12', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        for (const userId of ['u1', 'u2', 'u3', 'u4']) {
            for (let i = 0; i < 10; i++) {
                updateChannelHeat('chan-packed', userId, ChannelActivityType.Message);
            }
        }

        const mock = mockRes();
        await heatCommand.handler(mockReq({ channel_id: 'chan-packed' }), mock.res);

        const embed = mock.payload?.data.embeds as Array<Record<string, unknown>>;
        expect(embed[0].color).toBe(0xe74c3c);
        expect(embed[0].description).toContain('×2.0');
    });

    it('is ephemeral by default and public only when asked', async () => {
        const privateMock = mockRes();
        await heatCommand.handler(mockReq({ channel_id: 'chan-x' }), privateMock.res);
        expect(privateMock.payload?.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);

        const publicMock = mockRes();
        await heatCommand.handler(
            mockReq({ channel_id: 'chan-x', data: { options: [{ name: 'public', value: true }] } }),
            publicMock.res,
        );
        expect(publicMock.payload?.data.flags).toBeUndefined();
    });
});
