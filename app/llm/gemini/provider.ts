import { Type, type Chat, type FunctionDeclaration } from '@google/genai';
import { genai, DEFAULT_MODEL } from './gemini.ts';
import {
    LlmErrorKind,
    LlmProviderId,
    type LlmProvider,
    type LlmSession,
    type LlmTurn,
} from '../types.ts';
import { ToolParamType, type ToolFunctionDeclaration, type ToolResult } from '../tools/types.ts';

// app/llm/tools/ describes its schema in a repo-owned vocabulary so it never has to import
// an AI SDK; this is the one place that speaks genai's Type enum for it.
const GENAI_PARAM_TYPES: Record<ToolParamType, Type> = {
    [ToolParamType.OBJECT]: Type.OBJECT,
    [ToolParamType.STRING]: Type.STRING,
};

export function toGenaiFunctionDeclaration(
    declaration: ToolFunctionDeclaration,
): FunctionDeclaration {
    return {
        name: declaration.name,
        description: declaration.description,
        parameters: {
            type: GENAI_PARAM_TYPES[declaration.parameters.type],
            properties: Object.fromEntries(
                Object.entries(declaration.parameters.properties).map(([key, schema]) => [
                    key,
                    { type: GENAI_PARAM_TYPES[schema.type], description: schema.description },
                ]),
            ),
            required: declaration.parameters.required,
        },
    };
}

function toTurn(response: { text?: string; functionCalls?: unknown }): LlmTurn {
    const calls = (response.functionCalls ?? []) as Array<{
        name: string;
        args: Record<string, string>;
    }>;

    return {
        text: response.text ?? '',
        // No call ids in this API: the name is what a functionResponse is matched on.
        toolCalls: calls.map((call) => ({ id: call.name, name: call.name, args: call.args })),
    };
}

class GeminiSession implements LlmSession {
    private readonly chat: Chat;

    constructor(
        private readonly systemPrompt: string,
        tools: ToolFunctionDeclaration[],
    ) {
        this.chat = genai.chats.create({
            model: DEFAULT_MODEL,
            config: {
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: tools.map(toGenaiFunctionDeclaration) }],
            },
        });
    }

    async sendUserPrompt(prompt: string): Promise<LlmTurn> {
        return toTurn(await this.chat.sendMessage({ message: prompt }));
    }

    async sendToolResults(
        results: ToolResult[],
        { disarmTools }: { disarmTools: boolean },
    ): Promise<LlmTurn> {
        // Disarming means sending the results back with no tool declared, which leaves the
        // model no way to ask for another one and forces a textual answer. A per-request
        // config does not inherit from the chat's (SDK contract), so dropping `tools` is
        // enough — but `systemInstruction` has to be restated for the same reason.
        const response = await this.chat.sendMessage({
            message: results.map((result) => ({
                functionResponse: {
                    name: result.name,
                    response: { result: result.response },
                },
            })),
            ...(disarmTools ? { config: { systemInstruction: this.systemPrompt } } : {}),
        });

        return toTurn(response);
    }
}

export const geminiProvider: LlmProvider = {
    id: LlmProviderId.GEMINI,
    model: DEFAULT_MODEL,

    createSession({ systemPrompt, tools }) {
        return new GeminiSession(systemPrompt, tools);
    },

    classifyError(error) {
        const { status, message } = (error ?? {}) as { status?: number; message?: string };
        const overloaded =
            status === 503 || message?.includes('503') || message?.includes('UNAVAILABLE');

        return overloaded ? LlmErrorKind.OVERLOADED : LlmErrorKind.UNKNOWN;
    },
};
