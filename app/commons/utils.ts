import {
    InteractionResponseFlags,
    MessageComponentTypes,
} from 'discord-interactions';
import 'dotenv/config';

interface DiscordRequestOptions {
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
