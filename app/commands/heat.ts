import type { Request, Response } from 'express';
import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { getChannelHeatSnapshot } from '../idle/channel-activity.js';
import { replyText, replyEmbed, isPublicOption } from '../commons/utils.js';
import type { Command } from './types.js';

const PARAM_PUBLIC = 'public';

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
                        return `• <@${c.userId}> — \`${c.contribution.toFixed(2)}\` — ${pct}%`;
                    })
                    .join('\n'),
            },
        ];
    }

    return embed;
}

async function handleHeatCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as {
        channel_id?: string;
        data?: { options?: Array<{ name: string; value: unknown }> };
    };
    const channelId = body.channel_id;
    const isPublic = isPublicOption(body.data?.options);

    if (!channelId) {
        replyText(res, 'Impossible de déterminer le canal.', { ephemeral: true });
        return;
    }

    replyEmbed(res, formatHeatEmbed(channelId), { ephemeral: !isPublic });
}

export const heatCommand: Command = {
    definition: {
        name: 'heat',
        description: 'Affiche la chaleur de la conversation en cours et les participants actifs.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
        options: [
            {
                name: PARAM_PUBLIC,
                description: 'Rendre la réponse visible par tous (par défaut : privée)',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            },
        ],
    },
    handler: handleHeatCommand,
};
