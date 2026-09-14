import type { ToolCall, ToolFunctionDeclaration, ToolResult } from './tools/types.ts';

export enum LlmProviderId {
    GEMINI = 'gemini',
    OPENROUTER = 'openrouter',
}

/** Which entry point started a call; only surfaces in the logs. */
export enum LlmCallKind {
    ASK = 'ask',
    CHAT = 'chat',
    JACKPOT = 'jackpot',
    PROMOTION = 'promotion',
}

/** Error categories the callers act on, so no command handler has to read an SDK's shape. */
export enum LlmErrorKind {
    OVERLOADED = 'OVERLOADED',
    UNKNOWN = 'UNKNOWN',
}

/** One reply. `toolCalls` is empty when the model answered with text. */
export type LlmTurn = {
    text: string;
    toolCalls: ToolCall[];
    /** What this request was billed, when the backend reports it (OpenRouter does, Gemini does not). */
    costUsd?: number;
};

/**
 * An exchange in progress. The implementation carries the history — a genai chat object,
 * an OpenRouter message array — and the caller never sees it.
 */
export interface LlmSession {
    sendUserPrompt(prompt: string): Promise<LlmTurn>;
    /** `disarmTools`: the last round, where the model must be left no way to ask for one more. */
    sendToolResults(results: ToolResult[], options: { disarmTools: boolean }): Promise<LlmTurn>;
}

export interface LlmProvider {
    readonly id: LlmProviderId;
    readonly model: string;
    createSession(params: { systemPrompt: string; tools: ToolFunctionDeclaration[] }): LlmSession;
    /** The one place a backend's error shapes are read; the error itself is never wrapped. */
    classifyError(error: unknown): LlmErrorKind;
}
