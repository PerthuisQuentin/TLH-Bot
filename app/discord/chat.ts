import type { Message, TextChannel } from 'discord.js';
import { readGuildConfigOrNull } from '../commons/guild-config.ts';
import { chatNaturally } from '../gemini/ask-gemini.ts';
import { CONTEXT_MESSAGES_LIMIT } from '../commons/prompts.ts';
import { hasNicknameMention, shouldTriggerChat } from '../commons/chat-trigger.ts';
import { parseMessage } from './messages.ts';
import type { ConversationMessage } from './types.ts';

const DEFAULT_INDIRECT_PROBABILITY = 0.1;
const DEFAULT_RANDOM_PROBABILITY = 0.01;

/** Gateway-only: builds history from the discord.js cache, unlike `/ask`'s REST fetch. */
export async function maybeChatNaturally(message: Message, channelName: string): Promise<void> {
    const guildId = message.guildId;
    if (!guildId) return;

    const config = await readGuildConfigOrNull(guildId);
    if (!config) return;

    if (config.chatEnabled === false) return;
    if ((config.noChatChannels ?? []).includes(message.channelId)) return;

    const isDirectMention = message.mentions.users.has(message.client.user.id);
    const hasIndirectMention = hasNicknameMention(message.content, config.chatNicknames ?? []);

    const trigger = shouldTriggerChat({
        isDirectMention,
        hasIndirectMention,
        indirectProbability: config.chatIndirectProbability ?? DEFAULT_INDIRECT_PROBABILITY,
        randomProbability: config.chatRandomProbability ?? DEFAULT_RANDOM_PROBABILITY,
    });
    if (!trigger) return;

    console.log(
        `[Chat] Triggered | guildId=${guildId} | channelId=${message.channelId} | userId=${message.author.id} | kind=${trigger}`,
    );

    try {
        const channel = message.channel as TextChannel;
        const history = await channel.messages.fetch({
            limit: CONTEXT_MESSAGES_LIMIT,
            before: message.id,
        });

        const conversationContext: ConversationMessage[] = [...history.values()]
            .reverse()
            .map((historyMessage) => parseMessage(historyMessage))
            .filter((parsed): parsed is ConversationMessage => parsed !== null);

        const current = parseMessage(message);
        if (current) conversationContext.push(current);

        // Same chain as parseMessage: the instruction has to call them by the name the
        // history lines above it use, or the model is told about a stranger.
        const userName =
            message.member?.displayName ?? message.author.globalName ?? message.author.username;

        const { response } = await chatNaturally({
            guildId,
            channelName,
            conversationContext,
            userName,
        });

        if (response) await message.reply(response);
    } catch (error) {
        console.error(`[Chat] Error generating natural reply | guildId=${guildId}`, error);
    }
}
