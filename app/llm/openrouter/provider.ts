import type { ChatFunctionToolFunction, ChatMessages, ChatResult } from '@openrouter/sdk/models';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { openrouter, DEFAULT_MODEL } from './openrouter.ts';
import {
    LlmErrorKind,
    LlmProviderId,
    type LlmProvider,
    type LlmSession,
    type LlmTurn,
} from '../types.ts';
import { ToolParamType, type ToolFunctionDeclaration, type ToolResult } from '../tools/types.ts';

// OpenRouter takes plain JSON Schema, so the repo-owned vocabulary only has to be
// lowercased — no enum to import, unlike genai.
const OPENROUTER_PARAM_TYPES: Record<ToolParamType, string> = {
    [ToolParamType.OBJECT]: 'object',
    [ToolParamType.STRING]: 'string',
};

export function toOpenRouterTool(declaration: ToolFunctionDeclaration): ChatFunctionToolFunction {
    return {
        type: 'function',
        function: {
            name: declaration.name,
            description: declaration.description,
            parameters: {
                type: OPENROUTER_PARAM_TYPES[declaration.parameters.type],
                properties: Object.fromEntries(
                    Object.entries(declaration.parameters.properties).map(([key, schema]) => [
                        key,
                        {
                            type: OPENROUTER_PARAM_TYPES[schema.type],
                            description: schema.description,
                        },
                    ]),
                ),
                required: declaration.parameters.required,
            },
        },
    };
}

/** `send()` is typed as the result or a stream; we never set `stream`, so only one arm can occur. */
function assertResult(response: ChatResult | object): ChatResult {
    if (!('choices' in response)) {
        throw new Error('Réponse OpenRouter inattendue: flux reçu pour une requête non streamée');
    }

    return response;
}

class OpenRouterSession implements LlmSession {
    // No chat object here: the history is this array, resent whole on every request.
    private readonly messages: ChatMessages[];
    private readonly tools: ChatFunctionToolFunction[];

    constructor(systemPrompt: string, tools: ToolFunctionDeclaration[]) {
        this.messages = [{ role: 'system', content: systemPrompt }];
        this.tools = tools.map(toOpenRouterTool);
    }

    async sendUserPrompt(prompt: string): Promise<LlmTurn> {
        this.messages.push({ role: 'user', content: prompt });
        return this.send({ disarmTools: false });
    }

    async sendToolResults(
        results: ToolResult[],
        { disarmTools }: { disarmTools: boolean },
    ): Promise<LlmTurn> {
        for (const result of results) {
            // `toolCallId` is mandatory here: a result the model cannot attach to its call
            // is rejected outright, which is why `ToolCall` carries an id at all.
            this.messages.push({
                role: 'tool',
                toolCallId: result.id,
                content: result.response,
            });
        }

        return this.send({ disarmTools });
    }

    /** Omitting `tools` is how this API leaves the model no function to ask for. */
    private async send({ disarmTools }: { disarmTools: boolean }): Promise<LlmTurn> {
        const response = assertResult(
            await openrouter.chat.send({
                chatRequest: {
                    model: DEFAULT_MODEL,
                    // A copy: the array keeps growing after this call, and the request must
                    // carry the history as it stood when it was sent.
                    messages: [...this.messages],
                    ...(disarmTools ? {} : { tools: this.tools }),
                },
            }),
        );

        const message = response.choices[0].message;
        this.messages.push({ ...message, role: 'assistant' });

        return {
            text: typeof message.content === 'string' ? message.content : '',
            costUsd: response.usage?.cost ?? undefined,
            toolCalls: (message.toolCalls ?? []).map((call) => ({
                id: call.id,
                name: call.function.name,
                // Arguments arrive as a JSON-encoded string, not an object. A model that
                // emits malformed JSON must not take the whole answer down: the call is
                // reported with no arguments and the tool answers what it can.
                args: parseArguments(call.function.arguments),
            })),
        };
    }
}

function parseArguments(raw: string): Record<string, string> {
    try {
        return JSON.parse(raw) as Record<string, string>;
    } catch {
        console.error('[LLM] Arguments de tool illisibles | raw=', raw);
        return {};
    }
}

export const openrouterProvider: LlmProvider = {
    id: LlmProviderId.OPENROUTER,
    model: DEFAULT_MODEL,

    createSession({ systemPrompt, tools }) {
        return new OpenRouterSession(systemPrompt, tools);
    },

    // Every HTTP failure arrives as an OpenRouterError carrying its status; the codes below
    // are the ones a retry a moment later would fix, which is what OVERLOADED means here.
    classifyError(error) {
        const overloaded =
            error instanceof OpenRouterError && [429, 502, 503, 504].includes(error.statusCode);

        return overloaded ? LlmErrorKind.OVERLOADED : LlmErrorKind.UNKNOWN;
    },
};
