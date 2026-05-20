import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getChannelHeatSnapshot } from '../idle/channel-activity.js';
import type { Command } from './types.js';

function heatBar(heat: number, maxHeat = 7, length = 12): string {
    const filled = Math.min(length, Math.round((heat / maxHeat) * length));
    return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function formatHeatMessage(channelId: string): string {
    const { heat, multiplier, contributors } = getChannelHeatSnapshot(channelId);

    const bar = heatBar(heat);
    const heatLine = `🔥 **Chaleur du canal :** \`${bar}\` **${heat.toFixed(2)}** → ×${multiplier.toFixed(1)}`;

    if (contributors.length === 0) {
        return `${heatLine}\n*Aucune activité récente.*`;
    }

    const total = contributors.reduce((sum, c) => sum + c.contribution, 0);
    const participantLines = contributors
        .map((c) => {
            const pct = Math.round((c.contribution / total) * 100);
            return `• <@${c.userId}> — ${pct}%`;
        })
        .join('\n');

    return `${heatLine}\n\n**Participants actifs :**\n${participantLines}`;
}

async function handleHeatCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as { channel_id?: string };
    const channelId = body.channel_id;

    if (!channelId) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Impossible de déterminer le canal.' },
        });
        return;
    }

    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: formatHeatMessage(channelId) },
    });
}

export const heatCommand: Command = {
    definition: {
        name: 'heat',
        description: 'Affiche la chaleur de la conversation en cours et les participants actifs.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    handler: handleHeatCommand,
};
