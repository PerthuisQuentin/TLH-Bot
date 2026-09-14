import { chatWithLlm, type ChatParams } from './chat.ts';
import type { LlmCallKind } from './types.ts';

/**
 * An announcement decorates an event that already happened — the shells are credited
 * either way — so it must never throw and never come back empty: a model failure or a
 * blank answer falls back to `defaultMessage`. It never writes memory either, which is
 * what keeps it off the per-guild queue and out of a jackpot's way.
 */
export async function generateAnnouncement(params: {
    kind: LlmCallKind;
    defaultMessage: string;
    chat: Omit<ChatParams, 'saveMemory' | 'kind'>;
}): Promise<string> {
    const { kind, defaultMessage, chat } = params;
    try {
        const { response } = await chatWithLlm({ ...chat, kind, saveMemory: false });
        return response || defaultMessage;
    } catch (error) {
        console.error(`[Bot] Error generating ${kind} | guildId=${chat.guildId}`, error);
        return defaultMessage;
    }
}
