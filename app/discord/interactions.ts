import { InteractionResponseType, InteractionType } from 'discord-interactions';
import type { Request, Response } from 'express';
import { commands } from '../commands/index.ts';
import { parseComponentCustomId } from '../commons/utils.ts';

export async function handleInteraction(req: Request, res: Response): Promise<unknown> {
    const { type, data } = req.body as {
        type: InteractionType;
        data?: { name?: string; custom_id?: string };
    };

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

    if (type === InteractionType.MESSAGE_COMPONENT) {
        const customId = data?.custom_id ?? '';
        const parsed = parseComponentCustomId(customId);
        const command =
            parsed && commands.find((cmd) => cmd.definition.name === parsed.commandName);
        if (parsed && command?.onComponent) {
            return command.onComponent(req, res, parsed.action);
        }

        console.error(`unknown component: ${customId}`);
        return res.status(400).json({ error: 'unknown component' });
    }

    console.error('unknown interaction type', type);
    return res.status(400).json({ error: 'unknown interaction type' });
}
