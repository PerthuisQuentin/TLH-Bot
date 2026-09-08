import { Type, type FunctionDeclaration } from '@google/genai';
import { genai, DEFAULT_MODEL } from './gemini.ts';
import {
    createSystemPrompt,
    createUserPrompt,
    createQuestionInstruction,
    createRolePromotionInstruction,
    createJackpotInstruction,
    createNaturalChatInstruction,
} from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';
import { fileStore, AllowedFiles } from '../storage/index.ts';
import { parseResponse } from '../commons/response.ts';
import { enqueueForGuild } from '../commons/guild-queue.ts';
import { getWeather, formatWeatherData, weatherToolGemini } from '../tools/weather.ts';
import { ToolParamType, type ToolFunctionDeclaration } from '../tools/types.ts';

// app/tools/ describes its schema in a repo-owned vocabulary so it never has to import
// an AI SDK; this is the one place that speaks genai's Type enum for it.
const GENAI_PARAM_TYPES: Record<ToolParamType, Type> = {
    [ToolParamType.OBJECT]: Type.OBJECT,
    [ToolParamType.STRING]: Type.STRING,
};

function toGenaiFunctionDeclaration(declaration: ToolFunctionDeclaration): FunctionDeclaration {
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

const tools = [
    {
        functionDeclarations: [toGenaiFunctionDeclaration(weatherToolGemini)],
    },
];

/**
 * Tool rounds before the model is made to answer. `get_weather` is the only declared
 * tool: a legitimate answer resolves in one round, two if the model chains two cities
 * instead of asking for both at once. Past that it is not converging, and nothing used
 * to stop it — a round of quota burnt each time, and `/ask`'s deferred interaction
 * expiring after 15 minutes with the handler still looping.
 */
export const MAX_TOOL_ROUNDS = 5;

type FunctionResult = {
    name: string;
    response: string;
};

async function processFunctionCall(functionCall: {
    name: string;
    args: Record<string, string>;
}): Promise<FunctionResult> {
    const { name, args } = functionCall;

    if (name === 'get_weather') {
        try {
            const weatherData = await getWeather(args.city);
            return { name, response: formatWeatherData(weatherData) };
        } catch (error) {
            return {
                name,
                response: `Erreur lors de la récupération de la météo: ${(error as Error).message}`,
            };
        }
    }

    return { name, response: `Fonction inconnue: ${name}` };
}

type ChatWithGeminiParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    instruction: string;
    saveMemory?: boolean;
};

/**
 * Reading `memory.txt` and writing it back afterwards must not straddle a concurrent
 * call for the same guild, or whichever write lands last silently discards the other's
 * update. `saveMemory` callers therefore run through `enqueueForGuild` so the read only
 * happens once the guild's turn arrives, never before an earlier call has finished
 * writing. Read-only callers (`saveMemory: false`) skip the queue: the write below is
 * structurally gated behind `saveMemory`, so they can never race one into existence.
 */
async function chatWithGemini({
    guildId,
    channelName,
    conversationContext,
    instruction,
    saveMemory = true,
}: ChatWithGeminiParams): Promise<{ response: string; memory: string }> {
    const run = async (): Promise<{ response: string; memory: string }> => {
        const systemPrompt = await createSystemPrompt(guildId);
        const userPrompt = await createUserPrompt(
            channelName,
            conversationContext,
            instruction,
            guildId,
        );

        const chat = genai.chats.create({
            model: DEFAULT_MODEL,
            config: {
                systemInstruction: systemPrompt,
                tools,
            },
        });

        let response = await chat.sendMessage({ message: userPrompt });

        for (
            let round = 0;
            round < MAX_TOOL_ROUNDS && response.functionCalls && response.functionCalls.length > 0;
            round++
        ) {
            const functionResponses: FunctionResult[] = [];

            for (const functionCall of response.functionCalls) {
                const result = await processFunctionCall(
                    functionCall as { name: string; args: Record<string, string> },
                );
                functionResponses.push(result);
            }

            // Last round: send the results back with no tool declared, which leaves the model
            // no way to ask for another one and forces a textual answer. A per-request config
            // does not inherit from the chat's (SDK contract), so dropping `tools` is enough —
            // but `systemInstruction` has to be restated for the same reason.
            const isLastRound = round === MAX_TOOL_ROUNDS - 1;

            response = await chat.sendMessage({
                message: functionResponses.map((fr) => ({
                    functionResponse: {
                        name: fr.name,
                        response: { result: fr.response },
                    },
                })),
                ...(isLastRound ? { config: { systemInstruction: systemPrompt } } : {}),
            });
        }

        const fullResponse = response.text ?? '';
        const { response: botResponse, memory: botMemory } = parseResponse(fullResponse);

        if (saveMemory && botMemory) {
            try {
                await fileStore.writeText(guildId, AllowedFiles.MEMORY, botMemory);
                console.log(`[Memory] Updated | guildId=${guildId}`);
            } catch (error) {
                console.error(`[Memory] Error writing | guildId=${guildId}`, error);
            }
        }

        return { response: botResponse, memory: botMemory };
    };

    return saveMemory ? enqueueForGuild(guildId, run) : run();
}

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

    return chatWithGemini({
        guildId,
        channelName,
        conversationContext,
        instruction,
        saveMemory: true,
    });
}

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

    return chatWithGemini({
        guildId,
        channelName,
        conversationContext,
        instruction,
        saveMemory: true,
    });
}

/**
 * An announcement decorates an event that already happened — the shells are credited
 * either way — so it must never throw and never come back empty: a Gemini failure or a
 * blank answer falls back to `defaultMessage`. It never writes memory either, which is
 * what keeps it off the per-guild queue and out of a jackpot's way.
 */
async function generateAnnouncement(params: {
    kind: string;
    defaultMessage: string;
    chat: Omit<ChatWithGeminiParams, 'saveMemory'>;
}): Promise<string> {
    const { kind, defaultMessage, chat } = params;
    try {
        const { response } = await chatWithGemini({ ...chat, saveMemory: false });
        return response || defaultMessage;
    } catch (error) {
        console.error(`[Bot] Error generating ${kind} | guildId=${chat.guildId}`, error);
        return defaultMessage;
    }
}

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
        kind: 'promotion',
        // Carries the same 🏅 marker as the generated message, so a Gemini failure does not
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
        kind: 'jackpot',
        defaultMessage: `🎉 JACKPOT ! ${userName} remporte le jackpot et gagne **${amount} 🐚** (×${multiplier}) ! 🎉`,
        chat: {
            guildId,
            channelName,
            conversationContext,
            instruction: createJackpotInstruction(userName, amount, multiplier),
        },
    });
}
