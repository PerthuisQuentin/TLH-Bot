import { chatWithLlm } from './chat.ts';
import { LlmCallKind } from './types.ts';
import { createQuestionInstruction } from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';

type AskParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    userName: string;
    userQuestion: string;
};

export async function ask(params: AskParams): Promise<{ response: string; memory: string }> {
    const { guildId, channelName, conversationContext, userName, userQuestion } = params;
    const instruction = createQuestionInstruction(userName, userQuestion);

    return chatWithLlm({
        kind: LlmCallKind.ASK,
        guildId,
        channelName,
        conversationContext,
        instruction,
        saveMemory: true,
    });
}
