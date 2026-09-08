import type { Message, PartialMessage } from 'discord.js';
import type { ConversationMessage, DisplayNameResolver } from './types.ts';

// Raw REST payloads, narrowed to the fields we read.
type ApiAuthor = {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
};

type ApiMention = {
    id: string;
    username: string;
};

type ApiMessage = {
    type: number;
    content?: string;
    author: ApiAuthor;
    mentions?: ApiMention[];
    components?: Array<{ content?: string }>;
    timestamp: string;
};

function replaceMentions(content: string, mentions: ApiMention[]): string {
    if (mentions.length === 0) return content;
    return content.replace(/<@(\d+)>/g, (match, id: string) => {
        const mention = mentions.find((m) => m.id === id);
        return mention ? `@${mention.username}` : match;
    });
}

// Type 0 is a regular message, type 20 an application-command reply whose text
// sits in the first component. Anything else carries no readable content.
function extractContent(message: ApiMessage): string {
    if (message.type === 0) return message.content ?? '';
    if (message.type === 20) return message.components?.[0]?.content ?? '';
    return '';
}

function parseApiMessage(
    message: ApiMessage,
    resolveDisplayName?: DisplayNameResolver,
): ConversationMessage | null {
    const content = replaceMentions(extractContent(message), message.mentions ?? []);
    if (!content) return null;

    return {
        userId: message.author.id,
        // Falls back to the global name when the member was never cached, which is
        // exactly what this path used to show for everyone.
        displayName:
            resolveDisplayName?.(message.author.id) ??
            message.author.global_name ??
            message.author.username,
        handle: message.author.username,
        isBot: message.author.bot ?? false,
        content,
        sentAt: new Date(message.timestamp),
    };
}

/** Channel history comes back newest-first; the LLM reads it chronologically. */
export function parseApiMessages(
    raw: unknown[],
    resolveDisplayName?: DisplayNameResolver,
): ConversationMessage[] {
    return (raw as ApiMessage[])
        .map((message) => parseApiMessage(message, resolveDisplayName))
        .filter((message): message is ConversationMessage => message !== null)
        .reverse();
}

export function parseMessage(message: Message | PartialMessage): ConversationMessage | null {
    const { author, content } = message;
    if (!author || !content) return null;

    const mentions = message.mentions.users.map((user) => ({
        id: user.id,
        username: user.username,
    }));

    return {
        userId: author.id,
        displayName: message.member?.displayName ?? author.globalName ?? author.username,
        handle: author.username,
        isBot: author.bot,
        content: replaceMentions(content, mentions),
        sentAt: message.createdAt,
    };
}
