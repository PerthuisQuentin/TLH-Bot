import { generateAnnouncement } from './announcement.ts';
import { LlmCallKind } from './types.ts';
import { createJackpotInstruction } from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';

type GenerateJackpotParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    userName: string;
    amount: string;
    multiplier: number;
};

export async function generateJackpotMessage(params: GenerateJackpotParams): Promise<string> {
    const { guildId, channelName, conversationContext, userName, amount, multiplier } = params;

    return generateAnnouncement({
        kind: LlmCallKind.JACKPOT,
        defaultMessage: `🎉 JACKPOT ! ${userName} remporte le jackpot et gagne **${amount} 🐚** (×${multiplier}) ! 🎉`,
        chat: {
            guildId,
            channelName,
            conversationContext,
            instruction: createJackpotInstruction(userName, amount, multiplier),
        },
    });
}
