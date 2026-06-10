import {
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
} from 'discord-interactions';
import type { Response as ExpressResponse } from 'express';
import 'dotenv/config';

type DiscordRequestOptions = {
    method: string;
    body?: unknown;
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
            'User-Agent':
                'DiscordBot (https://github.com/discord/discord-example-app, 1.0.0)',
        },
    };
    if (options.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
        const data = await res.json();
        console.log(res.status);
        throw new Error(JSON.stringify(data));
    }
    return res;
}

export async function InstallGlobalCommands(
    appId: string | undefined,
    commands: unknown[],
): Promise<void> {
    const endpoint = `applications/${appId}/commands`;
    try {
        await DiscordRequest(endpoint, { method: 'PUT', body: commands });
    } catch (err) {
        console.error(err);
    }
}

export async function updateInteractionResponse(
    interactionToken: string,
    messageBody: unknown,
): Promise<unknown> {
    const endpoint = `webhooks/${process.env.APP_ID}/${interactionToken}/messages/@original`;
    const response = await DiscordRequest(endpoint, {
        method: 'PATCH',
        body: messageBody,
    });
    return response.json();
}

export function createMessageBody(content: string): object {
    return {
        flags: InteractionResponseFlags.IS_COMPONENTS_V2,
        components: [
            {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content,
            },
        ],
    };
}

// ─── Interaction response helpers ────────────────────────────────────────────

const EPHEMERAL_FLAG = 1 << 6;

export function replyText(
    res: ExpressResponse,
    content: string,
    options: { ephemeral?: boolean } = {},
): void {
    res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content,
            ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
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
            ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
            ...(options.suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
        },
    });
}

export function replyDeferred(res: ExpressResponse): void {
    res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
}

// ─── Interaction option helpers ───────────────────────────────────────────────

export type DiscordOption = {
    name: string;
    value?: unknown;
};

export function getOption<T = string>(options: ReadonlyArray<DiscordOption> | undefined, name: string): T | undefined {
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
