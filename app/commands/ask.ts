import { InteractionResponseType } from 'discord-interactions';
import type { Request, Response } from 'express';
import {
    createMessageBody,
    updateInteractionResponse,
    DiscordRequest,
} from '../commons/utils.js';
import { CONTEXT_MESSAGES_LIMIT } from '../commons/prompts.js';
import { formatMessagesContext } from '../commons/messages.js';
import { ask } from '../gemini/ask-gemini.js';
import { readJsonFile, AllowedFiles } from '../commons/files.js';
import {
    type APIChatInputApplicationCommandInteraction,
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
} from 'discord-api-types/v10';
import { Command } from './types.js';

async function handleAskCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as APIChatInputApplicationCommandInteraction;
    const { data } = body;
    const guildId = body.guild_id ?? 'dm';
    const channelId = body.channel_id!;

    const config = await readJsonFile<{ noAskChannels?: string[] }>(
        guildId,
        AllowedFiles.CONFIG,
        {},
    );
    const noAskChannels = config.noAskChannels ?? [];
    if (noAskChannels.includes(channelId)) {
        res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Je ne suis pas autorisé à répondre dans ce canal.",
                flags: MessageFlags.Ephemeral,
            },
        });
        return;
    }

    const userQuestion = (data?.options?.find(
        (opt) => opt.name === 'question',
    ) as { value?: string } | undefined)?.value;

    res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });

    try {
        const userId =
            body.member?.user?.id ?? body.user?.id ?? '';
        const userName =
            body.member?.nick ??
            body.member?.user?.global_name ??
            body.member?.user?.username ??
            body.user?.global_name ??
            body.user?.username ??
            'Utilisateur';

        let conversationContext = '';
        let channelName = 'canal inconnu';

        try {
            const channelResponse = await DiscordRequest(`channels/${channelId}`, {
                method: 'GET',
            });
            const channelData = await channelResponse.json() as { name?: string };
            channelName = channelData.name ?? 'canal inconnu';

            const messagesResponse = await DiscordRequest(
                `channels/${channelId}/messages?limit=${CONTEXT_MESSAGES_LIMIT}`,
                { method: 'GET' },
            );
            const messages = await messagesResponse.json() as unknown[];
            conversationContext = formatMessagesContext(
                messages as Parameters<typeof formatMessagesContext>[0],
            );
        } catch (error) {
            console.error('Error fetching messages:', error);
        }

        const { response: botResponse } = await ask({
            guildId,
            userId,
            channelId,
            channelName,
            conversationContext,
            userName,
            userQuestion: userQuestion ?? '',
        });

        const interactionToken = body.token;
        const updatedMessage = await updateInteractionResponse(
            interactionToken,
            createMessageBody(
                `**Question de ${userName} :** ${userQuestion}\n\n${botResponse}`,
            ),
        ) as { id?: string } | null;

        const logTimestamp = new Date().toISOString();
        const questionPreview = (userQuestion ?? '').substring(0, 20);
        console.log(
            `[Bot] Message posted | channelId=${channelId} | messageId=${updatedMessage?.id} | date=${logTimestamp} | question="${questionPreview}"`,
        );
    } catch (err) {
        const error = err as { status?: number; message?: string };
        console.error(`[Bot] Error handling ask command | channelId=${channelId}`, err);
        const interactionToken = body.token;

        const isOverloaded =
            error?.status === 503 ||
            error?.message?.includes('503') ||
            error?.message?.includes('UNAVAILABLE');

        const errorMessage = isOverloaded
            ? 'Mon cerveau Google est surchargé 🧠💥 Réessaie dans quelques instants !'
            : 'Une erreur est survenue lors de la requête.';

        await updateInteractionResponse(
            interactionToken,
            createMessageBody(errorMessage),
        );
    }
}

export const askCommand: Command = {
    definition: {
        name: 'ask',
        description: 'Pose une question au bot',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
        options: [
            {
                type: ApplicationCommandOptionType.String,
                name: 'question',
                description: 'La question à poser',
                required: true,
            },
        ],
    },
    handler: handleAskCommand,
};
