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

type HeatEmbed = {
    title: string;
    description: string;
    color: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
};

function formatHeatEmbed(channelId: string): HeatEmbed {
    const { heat, multiplier, contributors } = getChannelHeatSnapshot(channelId);

    const bar = heatBar(heat);
    const description =
        contributors.length === 0
            ? '*Aucune activité récente.*'
            : `\`${bar}\` **${heat.toFixed(2)}** → ×${multiplier.toFixed(1)}`;

    const embed: HeatEmbed = {
        title: '🔥 Chaleur du canal',
        description,
        color: multiplier >= 2.0 ? 0xe74c3c : multiplier >= 1.6 ? 0xe67e22 : multiplier >= 1.2 ? 0xf1c40f : 0x2ecc71,
    };

    if (contributors.length > 0) {
        const total = contributors.reduce((sum, c) => sum + c.contribution, 0);
        embed.fields = [
            {
                name: 'Participants actifs',
                value: contributors
                    .map((c) => {
                        const pct = Math.round((c.contribution / total) * 100);
                        return `• <@${c.userId}> — ${pct}%`;
                    })
                    .join('\n'),
            },
        ];
    }

    return embed;
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
        data: { embeds: [formatHeatEmbed(channelId)] },
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
