import type {
    GuildMember,
    Message,
    MessageReaction,
    PartialMessage,
    PartialMessageReaction,
    TextChannel,
    User,
    PartialUser,
} from 'discord.js';
import type { ConversationMessage, DiscordEvent } from './types.ts';
import { ChannelActivityType } from '../idle/core/types.ts';
import { handleDiscordEvent } from '../idle/handlers/handle-event.ts';
import { formatBigNum } from '../idle/core/big-number.ts';
import { generateJackpotMessage, generateRolePromotionMessage } from '../gemini/ask-gemini.ts';
import { applyRoleChanges } from './roles.ts';
import { parseMessage } from './messages.ts';
import { maybeChatNaturally } from './chat.ts';

// `conversation` only feeds the generated announcements, so it stays out of
// DiscordEvent, which the game domain consumes.
async function handleEvent(
    event: DiscordEvent,
    channel: TextChannel,
    member: GuildMember | null,
    conversation: ConversationMessage[],
): Promise<void> {
    try {
        const result = await handleDiscordEvent(event);

        if (result.jackpot) {
            try {
                const jackpotMessage = await generateJackpotMessage({
                    guildId: event.guildId,
                    channelName: event.channelName,
                    conversationContext: conversation,
                    userName: event.displayName,
                    amount: formatBigNum(result.jackpot.amount),
                    multiplier: result.jackpot.multiplier,
                });
                await channel.send(`<@${event.userId}> ${jackpotMessage}`);
            } catch (error) {
                console.error(
                    `[Bot] Error sending jackpot message | userId=${event.userId}`,
                    error,
                );
            }
        }

        if (result.pendingRoleChanges && member) {
            try {
                const addedRoleName = await applyRoleChanges(member, result.pendingRoleChanges);
                if (addedRoleName) {
                    try {
                        const promotionMessage = await generateRolePromotionMessage({
                            guildId: event.guildId,
                            channelName: event.channelName,
                            conversationContext: conversation,
                            userName: event.displayName,
                            roleName: addedRoleName,
                        });
                        await channel.send(`<@${event.userId}> ${promotionMessage}`);
                    } catch (error) {
                        console.error(
                            `[Bot] Error sending promotion | userId=${event.userId}`,
                            error,
                        );
                    }
                }
            } catch (error) {
                console.error(
                    `[Shells] Error applying role changes | userId=${event.userId}`,
                    error,
                );
            }
        }
    } catch (error) {
        console.error(`[Shells] Error handling message event | userId=${event.userId}`, error);
    }
}

function toConversation(message: Message | PartialMessage): ConversationMessage[] {
    const parsed = parseMessage(message);
    return parsed ? [parsed] : [];
}

export async function handleMessage(message: Message): Promise<void> {
    const member = message.member;
    const channelName =
        ('name' in message.channel ? (message.channel as TextChannel).name : null) ?? 'canal';

    const event: DiscordEvent = {
        guildId: message.guildId!,
        channelId: message.channelId,
        channelName,
        userId: message.author.id,
        activityType: ChannelActivityType.Message,
        displayName: member?.displayName ?? message.author.username,
        currentRoleIds: member?.roles.cache.map((r) => r.id) ?? [],
    };

    // Independent, so they run concurrently: the economy writes game instances and posts
    // its own announcements, the chat reads config/memory and replies to this message.
    // Only the chat takes a per-guild AI queue slot — announcements pass `saveMemory: false`
    // and skip it — so neither can block the other. Both swallow their own errors, which is
    // what allSettled records rather than relies on.
    await Promise.allSettled([
        handleEvent(event, message.channel as TextChannel, member, toConversation(message)),
        maybeChatNaturally(message, channelName),
    ]);
}

// The actor is the reactor; crediting the message author is a domain rule.
export async function handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
): Promise<void> {
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
    } catch (error) {
        console.error('[Shells] Failed to fetch partial reaction/message', error);
        return;
    }

    const message = reaction.message;
    const { guild, guildId } = message;
    if (!guild || !guildId) return;

    let reactor: User;
    try {
        reactor = user.partial ? await user.fetch() : user;
    } catch (error) {
        console.error('[Shells] Failed to fetch partial user', error);
        return;
    }
    if (reactor.bot) return;

    let member: GuildMember | null = null;
    try {
        member = await guild.members.fetch(reactor.id);
    } catch (error) {
        console.error('[Shells] Failed to fetch reaction member', error);
    }

    const author = message.author;
    const channelName =
        ('name' in message.channel ? (message.channel as TextChannel).name : null) ?? 'canal';

    const event: DiscordEvent = {
        guildId,
        channelId: message.channelId,
        channelName,
        userId: reactor.id,
        activityType: ChannelActivityType.Reaction,
        displayName: member?.displayName ?? reactor.username,
        currentRoleIds: member?.roles.cache.map((r) => r.id) ?? [],
        ...(author && !author.bot ? { messageAuthorId: author.id } : {}),
    };

    await handleEvent(event, message.channel as TextChannel, member, toConversation(message));
}
