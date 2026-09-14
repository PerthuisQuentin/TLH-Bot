import { OpenRouter } from '@openrouter/sdk';

export const openrouter = new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    // Optional, and only used by OpenRouter's public rankings.
    appTitle: 'TLH Bot',
});

// Same model the Gemini adapter calls directly, so switching backends changes the path
// and nothing else. Any id from https://openrouter.ai/api/v1/models declaring `tools`.
export const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite';
