import {
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
} from 'discord-interactions';
import type { Response as ExpressResponse } from 'express';
import { MessageFlags } from 'discord-api-types/v10';
import type { APIMessageTopLevelComponent } from 'discord-api-types/v10';

type DiscordRequestOptions = {
    method: string;
    body?: unknown;
};

/** Thrown on any non-2xx. Carries the status so callers branch on it, not on the text. */
export class DiscordApiError extends Error {
    constructor(
        readonly status: number,
        readonly endpoint: string,
        readonly body: string,
    ) {
        super(`Discord ${status} on ${endpoint}: ${body || '(empty body)'}`);
        this.name = 'DiscordApiError';
    }
}

export async function DiscordRequest(
    endpoint: string,
    options: DiscordRequestOptions,
): Promise<Response> {
    const url = 'https://discord.com/api/v10/' + endpoint;
    const fetchOptions: RequestInit = {
        method: options.method,
        headers: {
            Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'User-Agent': 'DiscordBot (https://github.com/PerthuisQuentin/TLH-Bot, 1.0.0)',
        },
    };
    if (options.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
        // Read as text: an edge 502 is HTML and a rate-limited 429 can be empty, so
        // res.json() would throw a parse error that buries the status we came for.
        const body = await res.text().catch(() => '');
        throw new DiscordApiError(res.status, endpoint, body.slice(0, 500));
    }
    return res;
}

/**
 * Overwrites the app's global command list. Rejects on anything but a success: the caller
 * is a CLI whose whole job is to report whether the push landed.
 */
export async function InstallGlobalCommands(
    appId: string | undefined,
    commands: unknown[],
): Promise<void> {
    // Without this the URL is `applications/undefined/commands`, which Discord does answer
    // — with a form error about a bad snowflake, naming neither the missing variable nor
    // the fix.
    if (!appId) throw new Error('APP_ID is not set, cannot register commands');

    await DiscordRequest(`applications/${appId}/commands`, { method: 'PUT', body: commands });
}

/**
 * Model-generated text can echo any mention syntax a tool handed it (e.g. a role mention
 * from `get_role_thresholds`). Keeping `users` lets a deliberate `<@id>` ping through —
 * pinging the one member a question is about is expected — while dropping `roles` and
 * `everyone` stops a role listing from mass-pinging everyone who holds each role.
 */
export const USER_MENTIONS_ONLY = { parse: ['users'] } as const;

/**
 * Edits an interaction's deferred reply. Components V2, unlike every immediate reply below:
 * the flag makes `content` and `embeds` unusable, so this path is components-only.
 */
export async function updateInteractionResponse(
    interactionToken: string,
    content: string,
): Promise<unknown> {
    const endpoint = `webhooks/${process.env.APP_ID}/${interactionToken}/messages/@original`;
    const response = await DiscordRequest(endpoint, {
        method: 'PATCH',
        body: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content }],
            allowed_mentions: USER_MENTIONS_ONLY,
        },
    });
    return response.json();
}

/**
 * Same edit, but for the one place that has nowhere left to report a failure: a handler's
 * own error path, past the defer. Rethrowing there would send the rejection to Express
 * with the headers already gone, and leave the user's spinner running until it expires.
 *
 * Only for that last-resort call. On the nominal path use `updateInteractionResponse`,
 * which throws — that is what lets a handler fall back to an error message at all.
 */
export async function updateInteractionResponseOrLog(
    interactionToken: string,
    content: string,
): Promise<void> {
    try {
        await updateInteractionResponse(interactionToken, content);
    } catch (error) {
        console.error('[Discord] Failed to edit the deferred reply', error);
    }
}

// ─── Interaction response helpers ────────────────────────────────────────────

export function replyText(
    res: ExpressResponse,
    content: string,
    options: { ephemeral?: boolean } = {},
): void {
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content,
            ...(options.ephemeral ? { flags: InteractionResponseFlags.EPHEMERAL } : {}),
        },
    });
}

export function replyEmbed(
    res: ExpressResponse,
    embed: object,
    options: { ephemeral?: boolean; suppressMentions?: boolean } = {},
): void {
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            embeds: [embed],
            ...(options.ephemeral ? { flags: InteractionResponseFlags.EPHEMERAL } : {}),
            ...(options.suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
        },
    });
}

/** A Components V2 reply: the flag rules out `content` and `embeds` on this message for good. */
export function replyComponents(
    res: ExpressResponse,
    components: APIMessageTopLevelComponent[],
    options: { ephemeral?: boolean; suppressMentions?: boolean } = {},
): void {
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            components,
            flags:
                InteractionResponseFlags.IS_COMPONENTS_V2 |
                (options.ephemeral ? InteractionResponseFlags.EPHEMERAL : 0),
            ...(options.suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
        },
    });
}

/**
 * Answers a component click by rewriting the message it sits on. That message is V2, and a
 * V2 message can only be rewritten as V2. Ephemerality carries over on its own.
 */
export function updateComponents(
    res: ExpressResponse,
    components: APIMessageTopLevelComponent[],
    options: { suppressMentions?: boolean } = {},
): void {
    res.send({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
            components,
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            ...(options.suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
        },
    });
}

/**
 * Buys 15 minutes, and splits the handler in two: past this call the reply helpers above
 * are useless, the only way back to the user being `updateInteractionResponse` — and
 * `updateInteractionResponseOrLog` on the error path. See the defer boundary in
 * `docs/architecture.md`, which is what a rejection on either side actually costs.
 */
export function replyDeferred(res: ExpressResponse): void {
    res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
}

// ─── Interaction option helpers ───────────────────────────────────────────────

/** `<command>:<action>`: the prefix routes a click back to the command that drew the button. */
export function componentCustomId(commandName: string, action: string): string {
    return `${commandName}:${action}`;
}

/**
 * Who posted the public message a click landed on, or undefined when the message is
 * ephemeral. A shared panel keeps naming its sharer when someone refreshes or pages it.
 */
export function sharedByOf(body: {
    message?: { flags?: number; interaction_metadata?: { user?: { id: string } } };
}): string | undefined {
    const message = body.message;
    if (!message || (message.flags ?? 0) & MessageFlags.Ephemeral) return undefined;
    return message.interaction_metadata?.user?.id;
}

export function parseComponentCustomId(
    customId: string,
): { commandName: string; action: string } | undefined {
    const separator = customId.indexOf(':');
    if (separator <= 0 || separator === customId.length - 1) return undefined;
    return { commandName: customId.slice(0, separator), action: customId.slice(separator + 1) };
}

type DiscordOption = {
    name: string;
    value?: unknown;
};

export function getOption<T = string>(
    options: ReadonlyArray<DiscordOption> | undefined,
    name: string,
): T | undefined {
    return options?.find((o) => o.name === name)?.value as T | undefined;
}

export function isPublicOption(options: ReadonlyArray<DiscordOption> | undefined): boolean {
    return getOption<boolean>(options, 'public') === true;
}

/**
 * Sends an ephemeral "guild-only" error and returns false if guild_id is absent.
 * Use as an early-return guard: `if (!requireGuild(res, guild_id)) return;`
 */
export function requireGuild(res: ExpressResponse, guildId: string | undefined): guildId is string {
    if (guildId) return true;
    replyText(res, 'Cette commande ne fonctionne que sur un serveur.', { ephemeral: true });
    return false;
}
