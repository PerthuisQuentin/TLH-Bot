import { genai, DEFAULT_MODEL } from './gemini.js';
import {
    createSystemPrompt,
    createUserPrompt,
    createQuestionInstruction,
    createRolePromotionInstruction,
} from '../commons/prompts.js';
import { writeTextFile, AllowedFiles } from '../commons/files.js';
import { parseResponse } from '../commons/response.js';
import {
    getWeather,
    formatWeatherData,
    weatherToolGemini,
} from '../tools/weather.js';
import {
    createReminder,
    formatReminderResponse,
    reminderToolGemini,
} from '../tools/reminder.js';

const tools = [
    {
        functionDeclarations: [weatherToolGemini, reminderToolGemini],
    },
];

type FunctionCallContext = {
    guildId: string;
    userId: string | null;
    channelId: string | null;
}

type FunctionResult = {
    name: string;
    response: string;
}

async function processFunctionCall(
    functionCall: { name: string; args: Record<string, string> },
    context: FunctionCallContext,
): Promise<FunctionResult> {
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
    } else if (name === 'create_reminder') {
        try {
            const { question, reminder_date } = args;
            const reminder = await createReminder(
                context.guildId,
                context.userId!,
                context.channelId!,
                question,
                reminder_date,
            );
            return { name, response: formatReminderResponse(reminder) };
        } catch (error) {
            return {
                name,
                response: `Erreur lors de la création du rappel: ${(error as Error).message}`,
            };
        }
    }

    return { name, response: `Fonction inconnue: ${name}` };
}

type ChatWithGeminiParams = {
    guildId: string;
    userId?: string | null;
    channelId?: string | null;
    userPrompt: string;
    saveMemory?: boolean;
}

async function chatWithGemini({
    guildId,
    userId = null,
    channelId = null,
    userPrompt,
    saveMemory = true,
}: ChatWithGeminiParams): Promise<{ response: string; memory: string }> {
    const systemPrompt = await createSystemPrompt(guildId);

    const chat = genai.chats.create({
        model: DEFAULT_MODEL,
        config: {
            systemInstruction: systemPrompt,
            tools,
        },
    });

    let response = await chat.sendMessage({ message: userPrompt });

    while (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses: FunctionResult[] = [];

        for (const functionCall of response.functionCalls) {
            const result = await processFunctionCall(
                functionCall as { name: string; args: Record<string, string> },
                { guildId, userId, channelId },
            );
            functionResponses.push(result);
        }

        response = await chat.sendMessage({
            message: functionResponses.map((fr) => ({
                functionResponse: {
                    name: fr.name,
                    response: { result: fr.response },
                },
            })),
        });
    }

    const fullResponse = response.text ?? '';
    const { response: botResponse, memory: botMemory } =
        parseResponse(fullResponse);

    if (saveMemory && botMemory) {
        try {
            await writeTextFile(guildId, AllowedFiles.MEMORY, botMemory);
            console.log(`[Memory] Updated | guildId=${guildId}`);
        } catch (error) {
            console.error(`[Memory] Error writing | guildId=${guildId}`, error);
        }
    }

    return { response: botResponse, memory: botMemory };
}

type AskParams = {
    guildId: string;
    userId: string;
    channelId: string;
    channelName: string;
    conversationContext: string;
    userName: string;
    userQuestion: string;
}

export async function ask(
    params: AskParams,
): Promise<{ response: string; memory: string }> {
    const { guildId, userId, channelId, channelName, conversationContext, userName, userQuestion } = params;
    const instruction = createQuestionInstruction(userName, userQuestion);
    const userPrompt = await createUserPrompt(
        channelName,
        conversationContext,
        instruction,
        guildId,
    );

    return chatWithGemini({ guildId, userId, channelId, userPrompt, saveMemory: true });
}

type GenerateRolePromotionParams = {
    guildId: string;
    channelName: string;
    conversationContext: string;
    userName: string;
    roleName: string;
}

export async function generateRolePromotionMessage(
    params: GenerateRolePromotionParams,
): Promise<string> {
    const { guildId, channelName, conversationContext, userName, roleName } = params;
    try {
        const instruction = createRolePromotionInstruction(userName, roleName);
        const userPrompt = await createUserPrompt(
            channelName,
            conversationContext,
            instruction,
            guildId,
        );

        const { response } = await chatWithGemini({ guildId, userPrompt, saveMemory: false });

        return response || `Félicitations ${userName} ! Tu as obtenu le rôle ${roleName} !`;
    } catch (error) {
        console.error(
            `[Bot] Error generating promotion | guildId=${guildId}`,
            error,
        );
        return `Félicitations ${userName} ! Tu as obtenu le rôle ${roleName} !`;
    }
}
