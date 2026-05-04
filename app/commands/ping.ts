import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { createMessageBody } from '../commons/utils.js';
import { Command } from './types.js';

async function handlePingCommand(_req: Request, res: Response): Promise<void> {
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: createMessageBody('Pong !'),
    });
}

export const pingCommand: Command = {
    definition: {
        name: 'ping',
        description: 'Ping :)',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
    },
    handler: handlePingCommand,
};
