import type { Request, Response } from 'express';
import { getChannelHeatSnapshot } from '../idle/core/heat/channel-activity.ts';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { APIMessageTopLevelComponent } from 'discord-api-types/v10';
import type { Command } from './types.ts';
import {
    actionRow,
    button,
    container,
    separator,
    shareFooter,
    text,
} from '../commons/components.ts';
import {
    componentCustomId,
    replyComponents,
    replyText,
    sharedByOf,
    updateComponents,
} from '../commons/utils.ts';

const COMMAND_NAME = 'heat';
const ACTION_REFRESH = 'refresh';
const ACTION_SHARE = 'share';

function heatBar(heat: number, maxHeat = 7, length = 12): string {
    const filled = Math.min(length, Math.round((heat / maxHeat) * length));
    return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function heatColor(multiplier: number): number {
    if (multiplier >= 2.0) return 0xe74c3c;
    if (multiplier >= 1.6) return 0xe67e22;
    if (multiplier >= 1.2) return 0xf1c40f;
    return 0x2ecc71;
}

function heatPanel(channelId: string, sharedBy?: string): APIMessageTopLevelComponent[] {
    const { heat, multiplier, contributors } = getChannelHeatSnapshot(channelId);

    const summary =
        contributors.length === 0
            ? '*Aucune activité récente.*'
            : `\`${heatBar(heat)}\` **${heat.toFixed(2)}** → ×${multiplier.toFixed(1)}`;

    const total = contributors.reduce((sum, c) => sum + c.contribution, 0);
    const contributorLines = contributors.map((c) => {
        const pct = Math.round((c.contribution / total) * 100);
        return `• <@${c.userId}> — \`${c.contribution.toFixed(2)}\` — ${pct}%`;
    });

    return [
        container(
            heatColor(multiplier),
            text(`## 🔥 Chaleur du canal\n${summary}`),
            ...(contributorLines.length > 0
                ? [text(`### Participants actifs\n${contributorLines.join('\n')}`)]
                : []),
            separator(),
            shareFooter(`Mis à jour <t:${Math.floor(Date.now() / 1000)}:R>`, {
                sharedBy,
                shareId: componentCustomId(COMMAND_NAME, ACTION_SHARE),
            }),
            actionRow(button('🔄 Rafraîchir', componentCustomId(COMMAND_NAME, ACTION_REFRESH))),
        ),
    ];
}

function channelIdOf(req: Request, res: Response): string | undefined {
    const channelId = (req.body as { channel_id?: string }).channel_id;
    if (!channelId) replyText(res, 'Impossible de déterminer le canal.', { ephemeral: true });
    return channelId;
}

async function handleHeatCommand(req: Request, res: Response): Promise<void> {
    const channelId = channelIdOf(req, res);
    if (!channelId) return;

    // An embed never pinged the contributors it listed; V2 text would, hence the suppression.
    replyComponents(res, heatPanel(channelId), { ephemeral: true, suppressMentions: true });
}

/** Anyone may refresh, public message included: heat belongs to the channel, not to a player. */
async function handleHeatComponent(req: Request, res: Response, action: string): Promise<void> {
    if (action !== ACTION_REFRESH && action !== ACTION_SHARE) {
        console.error(`unknown heat action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    const channelId = channelIdOf(req, res);
    if (!channelId) return;

    const body = req.body as {
        member?: { user?: { id: string } };
        user?: { id: string };
        message?: { flags?: number; interaction_metadata?: { user?: { id: string } } };
    };

    if (action === ACTION_SHARE) {
        const sharerId = body.member?.user?.id ?? body.user?.id;
        if (!sharerId) {
            replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
            return;
        }
        replyComponents(res, heatPanel(channelId, sharerId), { suppressMentions: true });
        return;
    }

    updateComponents(res, heatPanel(channelId, sharedByOf(body)), { suppressMentions: true });
}

export const heatCommand: Command = {
    definition: {
        name: COMMAND_NAME,
        description: 'Affiche la chaleur de la conversation en cours et les participants actifs.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    handler: handleHeatCommand,
    onComponent: handleHeatComponent,
};
