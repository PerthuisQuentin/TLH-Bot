import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { replyText } from '../commons/utils.ts';
import { Command } from './types.ts';

async function handlePingCommand(_req: Request, res: Response): Promise<void> {
    replyText(res, 'Pong !');
}

export const pingCommand: Command = {
    definition: {
        name: 'ping',
        description: 'Ping :)',
        type: ApplicationCommandType.ChatInput,
        integration_types: [
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ],
        contexts: [
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ],
    },
    handler: handlePingCommand,
};
