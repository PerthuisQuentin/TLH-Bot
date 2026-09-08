// Type-only, so it is erased at emit and this file keeps its zero runtime imports.
// The enum itself belongs to the domain — see app/idle/core/types.ts.
import type { ChannelActivityType } from '../idle/core/types.ts';

// A Discord message reduced to what the LLM layer needs. Parsed in app/discord/,
// rendered to text in app/commons/prompts.ts, never carried around as a string.
export type ConversationMessage = {
    userId: string;
    /** Nickname or global name: what members call each other. Not unique. */
    displayName: string;
    /** Globally unique Discord handle, rendered only to break a displayName tie. */
    handle: string;
    isBot: boolean;
    content: string;
    sentAt: Date;
};

/** Resolves a userId to the name members call them by; null when unknown. */
export type DisplayNameResolver = (userId: string) => string | null;

export type PendingRoleChanges = {
    addRoleId: string | null;
    removeRoleIds: string[];
};

export type DiscordEvent = {
    guildId: string;
    channelId: string;
    channelName: string;
    userId: string;
    activityType: ChannelActivityType;
    displayName: string;
    currentRoleIds: string[];
    messageAuthorId?: string;
};
