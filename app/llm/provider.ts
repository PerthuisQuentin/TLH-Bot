import { geminiProvider } from './gemini/provider.ts';
import { openrouterProvider } from './openrouter/provider.ts';
import { LlmProviderId, type LlmProvider } from './types.ts';

const PROVIDERS: Record<LlmProviderId, LlmProvider> = {
    [LlmProviderId.GEMINI]: geminiProvider,
    [LlmProviderId.OPENROUTER]: openrouterProvider,
};

/**
 * The backend for this process, from `AI_PROVIDER` (default `gemini`). Read per call
 * rather than memoized so a test can point it elsewhere. Adding a backend is an entry in
 * the map above and a folder beside this file, nothing else.
 */
export function getProvider(): LlmProvider {
    const id = process.env.AI_PROVIDER ?? LlmProviderId.GEMINI;
    const provider = PROVIDERS[id as LlmProviderId];

    if (!provider) {
        throw new Error(
            `AI_PROVIDER invalide: "${id}" — valeurs acceptées: ${Object.keys(PROVIDERS).join(', ')}`,
        );
    }

    return provider;
}
