import type { Message as DjsMessage } from 'discord.js';

interface DiscordMessageAuthor {
    id: string;
    username: string;
    global_name?: string;
    bot?: boolean;
}

interface DiscordMessageComponent {
    content?: string;
}

interface DiscordMention {
    id: string;
    username: string;
}

interface DiscordRawMessage {
    type: number;
    content?: string;
    author: DiscordMessageAuthor;
    mentions?: DiscordMention[];
    components?: DiscordMessageComponent[];
    timestamp: string;
}

function replaceMentions(content: string, mentions: DiscordMention[]): string {
    if (!mentions || mentions.length === 0) return content;
    return content.replace(/<@(\d+)>/g, (match, id: string) => {
        const mention = mentions.find((m) => m.id === id);
        return mention ? `@${mention.username}` : match;
    });
}

function extractContent(msg: DiscordRawMessage): string {
    if (msg.type === 0 && msg.content) {
        return msg.content;
    }
    if (msg.type === 20 && msg.components?.[0]?.content) {
        return msg.components[0].content;
    }
    return '';
}

function formatMessage(msg: DiscordRawMessage): string | null {
    let content = extractContent(msg);
    if (!content) return null;

    content = replaceMentions(content, msg.mentions ?? []);

    let displayName: string;
    if (msg.author.bot) {
        displayName = '🤖 ' + (msg.author.global_name ?? msg.author.username);
    } else {
        displayName = msg.author.global_name ?? msg.author.username;
    }
    const username = msg.author.username;
    const userId = msg.author.id;

    const timestamp = new Date(msg.timestamp);
    const dateStr = timestamp.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
    });
    const timeStr = timestamp.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `👤 ${displayName} (@${username}) [ID:${userId}] • 🕐 ${dateStr} ${timeStr}\n${content}`;
}

function formatMessagesContext(messages: DiscordRawMessage[]): string {
    return messages
        .reverse()
        .map(formatMessage)
        .filter((line): line is string => line !== null)
        .join('\n\n---\n\n');
}

function formatDiscordJsMessage(message: DjsMessage): string | null {
    return formatMessage({
        type: 0,
        content: message.content,
        author: {
            bot: message.author.bot,
            global_name: message.author.globalName ?? undefined,
            username: message.author.username,
            id: message.author.id,
        },
        mentions: [],
        timestamp: message.createdAt.toISOString(),
    });
}

export {
    replaceMentions,
    extractContent,
    formatMessage,
    formatMessagesContext,
    formatDiscordJsMessage,
};
