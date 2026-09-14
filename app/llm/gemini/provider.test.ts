import { describe, it, expect, afterEach, vi } from 'vitest';
import { Type, type Chat } from '@google/genai';
import { genai } from './gemini.ts';
import { geminiProvider, toGenaiFunctionDeclaration } from './provider.ts';
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

type SendParams = { message: unknown; config?: { systemInstruction?: string; tools?: unknown } };

/** Installs `reply` as the chat the real client would have returned. */
function fakeChat(reply: () => { text?: string; functionCalls?: unknown }) {
    const sendMessage = vi.fn<(params: SendParams) => Promise<ReturnType<typeof reply>>>(() =>
        Promise.resolve(reply()),
    );
    const create = vi
        .spyOn(genai.chats, 'create')
        .mockReturnValue({ sendMessage } as unknown as Chat);

    return { sendMessage, create };
}

describe('toGenaiFunctionDeclaration', () => {
    it("maps the repo's vocabulary onto genai's Type enum", () => {
        expect(toGenaiFunctionDeclaration(DECLARATION)).toEqual({
            name: 'get_something',
            description: 'Fait quelque chose',
            parameters: {
                type: Type.OBJECT,
                properties: { city: { type: Type.STRING, description: 'La ville' } },
                required: ['city'],
            },
        });
    });
});

describe('geminiProvider sessions', () => {
    it('declares the tools on the chat and normalizes a function call into a turn', async () => {
        const { sendMessage, create } = fakeChat(() => ({
            functionCalls: [{ name: 'get_something', args: { city: 'Paris' } }],
        }));

        const session = geminiProvider.createSession({
            systemPrompt: 'Tu es un bot de test.',
            tools: [DECLARATION],
        });
        const turn = await session.sendUserPrompt('Salut');

        expect(create.mock.calls[0][0].config?.tools).toEqual([
            { functionDeclarations: [toGenaiFunctionDeclaration(DECLARATION)] },
        ]);
        expect(sendMessage.mock.calls[0][0].message).toBe('Salut');
        expect(turn).toEqual({
            text: '',
            // No call ids in this API, so the name stands in as the pairing key.
            toolCalls: [{ id: 'get_something', name: 'get_something', args: { city: 'Paris' } }],
        });
    });

    it('sends tool results back as functionResponse parts, with no config below the cap', async () => {
        const { sendMessage } = fakeChat(() => ({ text: 'Il fait beau.' }));

        const session = geminiProvider.createSession({
            systemPrompt: 'Tu es un bot de test.',
            tools: [DECLARATION],
        });
        const turn = await session.sendToolResults(
            [{ id: 'get_something', name: 'get_something', response: '20°C' }],
            {
                disarmTools: false,
            },
        );

        expect(sendMessage.mock.calls[0][0].message).toEqual([
            { functionResponse: { name: 'get_something', response: { result: '20°C' } } },
        ]);
        // No per-request config: the chat's own tools stay in play.
        expect(sendMessage.mock.calls[0][0]).not.toHaveProperty('config');
        expect(turn).toEqual({ text: 'Il fait beau.', toolCalls: [] });
    });

    it('disarms by sending a config that declares no tool but restates the instruction', async () => {
        const { sendMessage } = fakeChat(() => ({ text: 'Réponse finale.' }));

        const session = geminiProvider.createSession({
            systemPrompt: 'Tu es un bot de test.',
            tools: [DECLARATION],
        });
        await session.sendToolResults(
            [{ id: 'get_something', name: 'get_something', response: '20°C' }],
            {
                disarmTools: true,
            },
        );

        const { config } = sendMessage.mock.calls[0][0];
        expect(config).toBeDefined();
        expect(config).not.toHaveProperty('tools');
        // A per-request config does not inherit the chat's, so this has to be restated.
        expect(config?.systemInstruction).toBe('Tu es un bot de test.');
    });
});

describe('geminiProvider.classifyError', () => {
    it.each([
        [Object.assign(new Error('503 UNAVAILABLE'), { status: 503 }), LlmErrorKind.OVERLOADED],
        [new Error('Got a 503 back'), LlmErrorKind.OVERLOADED],
        [new Error('model is UNAVAILABLE'), LlmErrorKind.OVERLOADED],
        [new Error('bad request'), LlmErrorKind.UNKNOWN],
        [undefined, LlmErrorKind.UNKNOWN],
    ])('classifies %o', (error, expected) => {
        expect(geminiProvider.classifyError(error)).toBe(expected);
    });
});
