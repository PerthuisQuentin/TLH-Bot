import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { InteractionResponseType } from 'discord-interactions';
import { pingCommand } from './ping.ts';

describe('pingCommand', () => {
    it('replies with Pong !', async () => {
        const send = vi.fn();
        const res = { send } as unknown as Response;

        await pingCommand.handler({} as Request, res);

        // Spelled out rather than compared to the helper that built it: that assertion
        // held whatever shape the code emitted, including a wrong one.
        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Pong !' },
        });
    });
});
