import { OpenRouter } from '@openrouter/sdk';

export const openrouter = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    // Optional, and only used by OpenRouter's public rankings.
    appTitle: 'TLH Bot',
});

// Any id from https://openrouter.ai/api/v1/models declaring `tools`. Independent from
// the Gemini adapter's own DEFAULT_MODEL (app/llm/gemini/gemini.ts) — nothing keeps the
// two in sync, so switching backends can change more than just the path.
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-3.5-flash-lite';
