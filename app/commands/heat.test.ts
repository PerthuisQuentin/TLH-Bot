import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import { heatCommand } from './heat.ts';
import { updateChannelHeat } from '../idle/core/heat/channel-activity.ts';
import { ChannelActivityType } from '../idle/core/types.ts';
import { mockRes, readPanel } from '../../test/discord-interaction.ts';

afterEach(() => {
    vi.useRealTimers();
});

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

async function open(body: Record<string, unknown>) {
    const mock = mockRes();
    await heatCommand.handler(mockReq(body), mock.res);
    return { ...readPanel(mock.payload), content: mock.payload?.data.content };
}

/** A click on a private panel unless `sharedBy` says it landed on a shared one. */
async function click(action: string, channelId = 'chan-x', sharedBy?: string) {
    const mock = mockRes();
    await heatCommand.onComponent!(
        mockReq({
            channel_id: channelId,
            member: { user: { id: 'u9' } },
            message: {
                flags: sharedBy ? 0 : InteractionResponseFlags.EPHEMERAL,
                interaction_metadata: { user: { id: sharedBy ?? 'u9' } },
            },
        }),
        mock.res,
        action,
    );
    return { ...readPanel(mock.payload), status: mock.status };
}

describe('heatCommand', () => {
    it('rejects a missing channel_id', async () => {
        expect((await open({})).content).toBe('Impossible de déterminer le canal.');
    });

    it('shows "no recent activity" for a channel that was never touched', async () => {
        const reply = await open({ channel_id: 'chan-untouched' });

        expect(reply.text).toContain('*Aucune activité récente.*');
        expect(reply.text).not.toContain('Participants actifs');
        expect(reply.accentColor).toBe(0x2ecc71); // green: multiplier stays x1.0
    });

    it('shows the bar (not "no activity") once a single contributor exists, still green', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        updateChannelHeat('chan-solo', 'u1', ChannelActivityType.Message);

        const reply = await open({ channel_id: 'chan-solo' });

        expect(reply.text).not.toContain('*Aucune activité récente.*');
        expect(reply.text).toContain('→ ×1.0');
        expect(reply.accentColor).toBe(0x2ecc71);
    });

    it('lists contributors with their share of the total, pinging none, and bumps the color tier', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        // Two messages each (contribution 0.5 -> 1.0) so heat = (2^2 - 1 - 1) / 2 = 1,
        // just enough to cross the x1.2 threshold (>= 0.5).
        updateChannelHeat('chan-duo', 'u1', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u1', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u2', ChannelActivityType.Message);
        updateChannelHeat('chan-duo', 'u2', ChannelActivityType.Message);

        const reply = await open({ channel_id: 'chan-duo' });

        expect(reply.text).toContain('### Participants actifs');
        expect(reply.text).toContain('<@u1>');
        expect(reply.text).toContain('<@u2>');
        expect(reply.text).toContain('50%');
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.accentColor).toBe(0xf1c40f); // heat 1.0 -> x1.2 tier
    });

    it('reaches the top color tier once heat crosses 12', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        for (const userId of ['u1', 'u2', 'u3', 'u4']) {
            for (let i = 0; i < 10; i++) {
                updateChannelHeat('chan-packed', userId, ChannelActivityType.Message);
            }
        }

        const reply = await open({ channel_id: 'chan-packed' });

        expect(reply.accentColor).toBe(0xe74c3c);
        expect(reply.text).toContain('×2.0');
    });

    it('always answers privately, offering to refresh and to share', async () => {
        const reply = await open({ channel_id: 'chan-x' });

        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeTruthy();
        expect(reply.flags & InteractionResponseFlags.IS_COMPONENTS_V2).toBeTruthy();
        expect(reply.buttons.map((b) => b.id).sort()).toEqual(['heat:refresh', 'heat:share']);
    });

    it('shares publicly, naming the sharer, keeping only the refresh', async () => {
        const reply = await click('share');

        expect(reply.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
        expect(reply.flags & InteractionResponseFlags.EPHEMERAL).toBeFalsy();
        expect(reply.allowedMentions).toEqual({ parse: [] });
        expect(reply.text).toContain('partagé par <@u9>');
        expect(reply.buttons.map((b) => b.id)).toEqual(['heat:refresh']);
    });

    it('keeps naming the sharer when anyone refreshes a shared panel', async () => {
        const reply = await click('refresh', 'chan-x', 'u1');

        expect(reply.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(reply.text).toContain('partagé par <@u1>');
        expect(reply.buttons.map((b) => b.id)).toEqual(['heat:refresh']);
    });

    it('offers a refresh that rewrites the panel with the heat as it is now', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const before = await open({ channel_id: 'chan-live' });
        expect(before.buttons.map((b) => b.id)).toContain('heat:refresh');
        expect(before.text).toContain('*Aucune activité récente.*');

        updateChannelHeat('chan-live', 'u1', ChannelActivityType.Message);
        const after = await click('refresh', 'chan-live');

        expect(after.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
        expect(after.allowedMentions).toEqual({ parse: [] });
        expect(after.text).toContain('<@u1>');
        // Refreshing a private panel keeps it shareable.
        expect(after.buttons.map((b) => b.id).sort()).toEqual(['heat:refresh', 'heat:share']);
    });

    it('rejects an action it never drew', async () => {
        expect((await click('nope')).status).toBe(400);
    });
});
