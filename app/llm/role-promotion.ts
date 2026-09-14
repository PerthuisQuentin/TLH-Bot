import { generateAnnouncement } from './announcement.ts';
import { LlmCallKind } from './types.ts';
import { createRolePromotionInstruction } from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';

type GenerateRolePromotionParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    userName: string;
    roleName: string;
};

export async function generateRolePromotionMessage(
    params: GenerateRolePromotionParams,
): Promise<string> {
    const { guildId, channelName, conversationContext, userName, roleName } = params;

    return generateAnnouncement({
        kind: LlmCallKind.PROMOTION,
        // Carries the same 🏅 marker as the generated message, so a model failure does not
        // produce the one promotion announcement nobody can tell from a jackpot.
        defaultMessage: `🏅 Félicitations ${userName} ! Tu as obtenu le rôle ${roleName} ! 🏅`,
        chat: {
            guildId,
            channelName,
            conversationContext,
            instruction: createRolePromotionInstruction(userName, roleName),
        },
    });
}
