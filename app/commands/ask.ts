import type { Request, Response } from 'express';
import {
    updateInteractionResponse,
    updateInteractionResponseOrLog,
    DiscordRequest,
    replyText,
    replyDeferred,
    getOption,
} from '../commons/utils.ts';
import { CONTEXT_MESSAGES_LIMIT } from '../commons/prompts.ts';
import { parseApiMessages } from '../discord/messages.ts';
import { guildDisplayNameResolver } from '../discord/members.ts';
import type { ConversationMessage } from '../discord/types.ts';
import { ask } from '../gemini/ask-gemini.ts';
import { fileStore, AllowedFiles } from '../storage/index.ts';
import {
    type APIChatInputApplicationCommandInteraction,
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import { Command } from './types.ts';

const PARAM_QUESTION = 'question';

/**
 * Everything that can still produce a normal reply, since it runs before the defer.
 * Reading the config is I/O and can fail — a malformed `{guildId}-config.json` used to
 * throw out of the handler with nothing sent at all, which Discord shows as
 * « L'application n'a pas répondu ». Returns false once a reply has been sent, so it
 * reads as an early-return guard like `requireGuild`.
 */
async function canAnswerHere(res: Response, guildId: string, channelId: string): Promise<boolean> {
    let config;
    try {
        config = await fileStore.readJson(guildId, AllowedFiles.CONFIG);
    } catch (error) {
        console.error(`[Bot] Error reading config | guildId=${guildId}`, error);
        replyText(res, 'Une erreur est survenue lors de la requête.', { ephemeral: true });
        return false;
    }

    if ((config.noAskChannels ?? []).includes(channelId)) {
        replyText(res, 'Je ne suis pas autorisé à répondre dans ce canal.', { ephemeral: true });
        return false;
    }

    return true;
}

async function handleAskCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as APIChatInputApplicationCommandInteraction;
    const { data } = body;
    const guildId = body.guild_id ?? 'dm';
    const channelId = body.channel_id;

    if (!(await canAnswerHere(res, guildId, channelId))) return;

    const userQuestion = getOption<string>(data?.options, PARAM_QUESTION);

    replyDeferred(res);

    try {
        const userId = body.member?.user?.id ?? body.user?.id ?? '';

        // Question header and history lines must name the asker identically, so both
        // read the same resolver. The interaction already carries their nickname.
        const known = new Map<string, string>();
        if (body.member?.nick) known.set(userId, body.member.nick);
        const resolveDisplayName = guildDisplayNameResolver(guildId, known);

        const userName =
            resolveDisplayName(userId) ??
            body.member?.user?.global_name ??
            body.member?.user?.username ??
            body.user?.global_name ??
            body.user?.username ??
            'Utilisateur';

        let conversationContext: ConversationMessage[] = [];
        let channelName = 'canal inconnu';

        try {
            const channelResponse = await DiscordRequest(`channels/${channelId}`, {
                method: 'GET',
            });
            const channelData = (await channelResponse.json()) as { name?: string };
            channelName = channelData.name ?? 'canal inconnu';

            const messagesResponse = await DiscordRequest(
                `channels/${channelId}/messages?limit=${CONTEXT_MESSAGES_LIMIT}`,
                { method: 'GET' },
            );
            conversationContext = parseApiMessages(
                (await messagesResponse.json()) as unknown[],
                resolveDisplayName,
            );
        } catch (error) {
            console.error('Error fetching messages:', error);
        }

        const { response: botResponse } = await ask({
            guildId,
            channelName,
            conversationContext,
            userName,
            userQuestion: userQuestion ?? '',
        });

        const interactionToken = body.token;
        const updatedMessage = (await updateInteractionResponse(
            interactionToken,
            `**Question de ${userName} :** ${userQuestion}\n\n${botResponse}`,
        )) as { id?: string } | null;

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

        // Last resort: this edit is the error report, so its own failure is only logged.
        await updateInteractionResponseOrLog(interactionToken, errorMessage);
    }
}

export const askCommand: Command = {
    definition: {
        name: 'ask',
        description: 'Pose une question au bot',
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
        options: [
            {
                type: ApplicationCommandOptionType.String,
                name: PARAM_QUESTION,
                description: 'La question à poser',
                required: true,
            },
        ],
    },
    handler: handleAskCommand,
};
