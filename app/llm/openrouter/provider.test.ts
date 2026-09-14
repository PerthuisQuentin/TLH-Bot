import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatMessages, ChatResult } from '@openrouter/sdk/models';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { openrouter } from './openrouter.ts';
import { openrouterProvider, toOpenRouterTool } from './provider.ts';
import { LlmErrorKind } from '../types.ts';
import { ToolParamType, type ToolFunctionDeclaration } from '../tools/types.ts';

afterEach(() => {
    vi.restoreAllMocks();
});

const DECLARATION: ToolFunctionDeclaration = {
    name: 'get_something',
    description: 'Fait quelque chose',
    parameters: {
        type: ToolParamType.OBJECT,
        properties: { city: { type: ToolParamType.STRING, description: 'La ville' } },
        required: ['city'],
    },
};

type SentRequest = { chatRequest: { messages?: ChatMessages[]; tools?: unknown; model?: string } };

/** Installs `reply` as the assistant message the real client would have returned. */
function fakeChat(reply: (call: number) => Partial<ChatResult['choices'][0]['message']>) {
    let call = 0;
    const send = vi.fn<(request: SentRequest) => Promise<ChatResult>>(() =>
        Promise.resolve({
            choices: [{ message: { role: 'assistant', content: '', ...reply(call++) } }],
        } as ChatResult),
    );

    vi.spyOn(openrouter.chat, 'send').mockImplementation(send);
    return send;
}

function session() {
    return openrouterProvider.createSession({
        systemPrompt: 'Tu es un bot de test.',
        tools: [DECLARATION],
    });
}

const WANTS_TOOL = {
    toolCalls: [
        {
            id: 'call_abc',
            type: 'function' as const,
            function: { name: 'get_something', arguments: '{"city":"Paris"}' },
        },
    ],
};

describe('toOpenRouterTool', () => {
    it("lowercases the repo's vocabulary into the JSON Schema the API expects", () => {
        expect(toOpenRouterTool(DECLARATION)).toEqual({
            type: 'function',
            function: {
                name: 'get_something',
                description: 'Fait quelque chose',
                parameters: {
                    type: 'object',
                    properties: { city: { type: 'string', description: 'La ville' } },
                    required: ['city'],
                },
            },
        });
    });
});

describe('openrouterProvider sessions', () => {
    it('opens with the system and user messages, tools declared', async () => {
        const send = fakeChat(() => WANTS_TOOL);

        const turn = await session().sendUserPrompt('Salut');

        expect(send.mock.calls[0][0].chatRequest.messages).toEqual([
            { role: 'system', content: 'Tu es un bot de test.' },
            { role: 'user', content: 'Salut' },
        ]);
        expect(send.mock.calls[0][0].chatRequest.tools).toEqual([toOpenRouterTool(DECLARATION)]);
        // The id the API minted is what a result will have to quote back.
        expect(turn).toEqual({
            text: '',
            toolCalls: [{ id: 'call_abc', name: 'get_something', args: { city: 'Paris' } }],
        });
    });

    it('answers a tool call with its toolCallId, after replaying the assistant turn', async () => {
        const send = fakeChat((call) => (call === 0 ? WANTS_TOOL : { content: 'Il fait beau.' }));

        const active = session();
        await active.sendUserPrompt('Salut');
        const turn = await active.sendToolResults(
            [{ id: 'call_abc', name: 'get_something', response: '20°C' }],
            { disarmTools: false },
        );

        const messages = send.mock.calls[1][0].chatRequest.messages ?? [];
        // The assistant turn has to come back too, or the tool result answers nothing.
        expect(messages).toHaveLength(4);
        expect(messages[3]).toEqual({
            role: 'tool',
            toolCallId: 'call_abc',
            content: '20°C',
        });
        expect(turn).toEqual({ text: 'Il fait beau.', toolCalls: [] });
    });

    it('disarms by omitting the tools entirely', async () => {
        const send = fakeChat(() => ({ content: 'Réponse finale.' }));

        await session().sendToolResults(
            [{ id: 'call_abc', name: 'get_something', response: '20°C' }],
            {
                disarmTools: true,
            },
        );

        expect(send.mock.calls[0][0].chatRequest).not.toHaveProperty('tools');
    });

    // Arguments cross the wire as a JSON string, so a model that mangles them must not
    // take the whole answer down with it.
    it('survives unparsable tool arguments, reporting the call with none', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fakeChat(() => ({
            toolCalls: [
                {
                    id: 'call_bad',
                    type: 'function' as const,
                    function: { name: 'get_something', arguments: '{city: Paris' },
                },
            ],
        }));

        const turn = await session().sendUserPrompt('Salut');

        expect(turn.toolCalls).toEqual([{ id: 'call_bad', name: 'get_something', args: {} }]);
    });
});

describe('openrouterProvider cost', () => {
    it('reports what OpenRouter billed for the request', async () => {
        vi.spyOn(openrouter.chat, 'send').mockResolvedValue({
            choices: [{ message: { role: 'assistant', content: 'Bon.' } }],
            usage: { cost: 0.00042, promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        } as ChatResult);

        const turn = await session().sendUserPrompt('Salut');

        expect(turn.costUsd).toBe(0.00042);
    });

    it('leaves the cost undefined when the response carries no usage', async () => {
        fakeChat(() => ({ content: 'Bon.' }));

        const turn = await session().sendUserPrompt('Salut');

        expect(turn.costUsd).toBeUndefined();
    });
});

describe('openrouterProvider.classifyError', () => {
    function httpError(statusCode: number): OpenRouterError {
        const error = Object.create(OpenRouterError.prototype) as { statusCode: number };
        error.statusCode = statusCode;
        return error as OpenRouterError;
    }

    it.each([
        [429, LlmErrorKind.OVERLOADED],
        [503, LlmErrorKind.OVERLOADED],
        [400, LlmErrorKind.UNKNOWN],
    ])('classifies HTTP %i', (status, expected) => {
        expect(openrouterProvider.classifyError(httpError(status))).toBe(expected);
    });

    it('leaves anything that is not an HTTP failure unknown', () => {
        expect(openrouterProvider.classifyError(new Error('boom'))).toBe(LlmErrorKind.UNKNOWN);
    });
});
