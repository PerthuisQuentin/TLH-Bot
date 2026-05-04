import { InteractionResponseType, InteractionType } from 'discord-interactions';
import type { Request, Response } from 'express';
import { commands } from '../commands/index.js';

export async function handleInteraction(
    req: Request,
    res: Response,
): Promise<unknown> {
    const { type, data } = req.body as { type: number; data?: { name?: string } };

    if (type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
    }

    if (type === InteractionType.APPLICATION_COMMAND) {
        const { name } = data ?? {};

        const command = commands.find((cmd) => cmd.definition.name === name);
        if (command) {
            return command.handler(req, res);
        }

        console.error(`unknown command: ${name}`);
        return res.status(400).json({ error: 'unknown command' });
    }

    console.error('unknown interaction type', type);
    return res.status(400).json({ error: 'unknown interaction type' });
}
