import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
} from 'discord-interactions';
import type { Response as ExpressResponse } from 'express';
import {
    getOption,
    isPublicOption,
    updateInteractionResponse,
    replyText,
    replyEmbed,
    replyDeferred,
    requireGuild,
    DiscordRequest,
    DiscordApiError,
    InstallGlobalCommands,
    updateInteractionResponseOrLog,
} from './utils.ts';

function mockRes(): { send: ReturnType<typeof vi.fn>; res: ExpressResponse } {
    const send = vi.fn();
    return { send, res: { send } as unknown as ExpressResponse };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('DiscordRequest', () => {
    function stubFetch(body: BodyInit | null, init: ResponseInit): void {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));
    }

    it('returns the response untouched on success', async () => {
        stubFetch(JSON.stringify({ id: '1' }), { status: 200 });

        const res = await DiscordRequest('channels/1', { method: 'GET' });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: '1' });
    });

    it('keeps the status when the error body is not JSON', async () => {
        // The regression: res.json() here threw a SyntaxError that replaced the 502.
        stubFetch('<html>Bad Gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
        });

        const error = await DiscordRequest('channels/1', { method: 'GET' }).catch(
            (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(DiscordApiError);
        expect((error as DiscordApiError).status).toBe(502);
        expect((error as DiscordApiError).message).toContain('502');
        expect((error as DiscordApiError).message).toContain('channels/1');
    });

    it('keeps the status when the error body is empty', async () => {
        stubFetch(null, { status: 429 });

        const error = (await DiscordRequest('channels/1', { method: 'POST' }).catch(
            (e: unknown) => e,
        )) as DiscordApiError;

        expect(error.status).toBe(429);
        expect(error.message).toContain('(empty body)');
    });

    it('exposes a JSON error body as text', async () => {
        stubFetch(JSON.stringify({ message: 'Unknown Message', code: 10008 }), { status: 404 });

        const error = (await DiscordRequest('channels/1/messages/2', { method: 'DELETE' }).catch(
            (e: unknown) => e,
        )) as DiscordApiError;

        expect(error.status).toBe(404);
        expect(error.body).toContain('Unknown Message');
    });

    it('sends a JSON body only when one is given', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {}));

        await DiscordRequest('a', { method: 'GET' });
        expect((fetchSpy.mock.calls[0][1] as RequestInit).body).toBeUndefined();

        await DiscordRequest('a', { method: 'POST', body: { x: 1 } });
        expect((fetchSpy.mock.calls[1][1] as RequestInit).body).toBe('{"x":1}');
    });
});

describe('InstallGlobalCommands', () => {
    const definitions = [{ name: 'ping' }, { name: 'shop' }];

    it('replaces the global command list with a single PUT', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 200 }));

        await InstallGlobalCommands('app-1', definitions);

        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://discord.com/api/v10/applications/app-1/commands');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body as string)).toEqual(definitions);
    });

    // The regression: this used to catch and log, so the promise resolved and
    // `npm run register` reported success on a rejected definition.
    it('rejects when Discord refuses the definitions', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ message: 'Invalid Form Body' }), { status: 400 }),
        );

        const error = (await InstallGlobalCommands('app-1', definitions).catch(
            (e: unknown) => e,
        )) as DiscordApiError;

        expect(error).toBeInstanceOf(DiscordApiError);
        expect(error.status).toBe(400);
        expect(error.body).toContain('Invalid Form Body');
    });

    it('refuses a missing APP_ID before reaching the network', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await expect(InstallGlobalCommands(undefined, definitions)).rejects.toThrow('APP_ID');

        // The point of the guard: `applications/undefined/commands` is a URL Discord
        // answers, so without it the run costs a request and returns a misleading error.
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('getOption', () => {
    it('returns the value of the matching option', () => {
        expect(
            getOption(
                [
                    { name: 'a', value: 1 },
                    { name: 'b', value: 2 },
                ],
                'b',
            ),
        ).toBe(2);
    });

    it('returns undefined when the option is absent', () => {
        expect(getOption([{ name: 'a', value: 1 }], 'missing')).toBeUndefined();
    });

    it('returns undefined when options itself is undefined', () => {
        expect(getOption(undefined, 'a')).toBeUndefined();
    });
});

describe('isPublicOption', () => {
    it('is true only when the public option is exactly boolean true', () => {
        expect(isPublicOption([{ name: 'public', value: true }])).toBe(true);
    });

    it('is false when the option is absent', () => {
        expect(isPublicOption([])).toBe(false);
        expect(isPublicOption(undefined)).toBe(false);
    });

    it('is false for a truthy non-boolean value', () => {
        expect(isPublicOption([{ name: 'public', value: 'true' }])).toBe(false);
    });

    it('is false when explicitly false', () => {
        expect(isPublicOption([{ name: 'public', value: false }])).toBe(false);
    });
});

describe('updateInteractionResponse', () => {
    it('patches the original reply with a components-v2 text display block', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ id: '42' }), { status: 200 }));
        process.env.APP_ID = 'app-1';

        const result = await updateInteractionResponse('tok-1', 'hello');

        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://discord.com/api/v10/webhooks/app-1/tok-1/messages/@original');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body as string)).toEqual({
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: 'hello' }],
        });
        expect(result).toEqual({ id: '42' });
    });
});

describe('updateInteractionResponseOrLog', () => {
    it('sends the same edit as updateInteractionResponse', async () => {
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ id: '42' }), { status: 200 }));
        process.env.APP_ID = 'app-1';

        await updateInteractionResponseOrLog('tok-1', 'hello');

        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://discord.com/api/v10/webhooks/app-1/tok-1/messages/@original');
        expect(JSON.parse(init.body as string)).toMatchObject({
            components: [{ type: MessageComponentTypes.TEXT_DISPLAY, content: 'hello' }],
        });
    });

    // Its whole reason to exist: the caller is a handler's error path, past the defer,
    // where a rethrow would reach Express with the headers already sent.
    it('resolves and logs instead of throwing when Discord refuses the edit', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(updateInteractionResponseOrLog('tok-1', 'hello')).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
    });

    it('swallows a transport failure too, not just a refusal', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(updateInteractionResponseOrLog('tok-1', 'hello')).resolves.toBeUndefined();
    });
});

describe('replyText', () => {
    it('sends a channel message with the given content', () => {
        const { send, res } = mockRes();
        replyText(res, 'hi there');

        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'hi there' },
        });
    });

    it('adds the ephemeral flag when asked', () => {
        const { send, res } = mockRes();
        replyText(res, 'hi there', { ephemeral: true });

        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'hi there', flags: InteractionResponseFlags.EPHEMERAL },
        });
    });
});

describe('replyEmbed', () => {
    it('wraps a single embed and can suppress mentions', () => {
        const { send, res } = mockRes();
        const embed = { title: 'Title' };
        replyEmbed(res, embed, { suppressMentions: true });

        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { embeds: [embed], allowed_mentions: { parse: [] } },
        });
    });
});

describe('replyDeferred', () => {
    it('sends the deferred response type with no data', () => {
        const { send, res } = mockRes();
        replyDeferred(res);

        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        });
    });
});

describe('requireGuild', () => {
    it('returns true and sends nothing when guildId is present', () => {
        const { send, res } = mockRes();
        expect(requireGuild(res, 'guild-1')).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it('returns false and sends an ephemeral error when guildId is missing', () => {
        const { send, res } = mockRes();
        expect(requireGuild(res, undefined)).toBe(false);
        expect(send).toHaveBeenCalledWith({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: 'Cette commande ne fonctionne que sur un serveur.',
                flags: InteractionResponseFlags.EPHEMERAL,
            },
        });
    });
});
