import { chatWithLlm } from './chat.ts';
import { LlmCallKind } from './types.ts';
import { createNaturalChatInstruction } from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';

type ChatNaturallyParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    userName: string;
};

export async function chatNaturally(
    params: ChatNaturallyParams,
): Promise<{ response: string; memory: string }> {
    const { guildId, channelName, conversationContext, userName } = params;
    const instruction = createNaturalChatInstruction(userName);

    return chatWithLlm({
        kind: LlmCallKind.CHAT,
        guildId,
        channelName,
        conversationContext,
        instruction,
        saveMemory: true,
    });
}
