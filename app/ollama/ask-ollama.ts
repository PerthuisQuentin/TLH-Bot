import { ollama, DEFAULT_MODEL } from './ollama.ts';
import {
    createSystemPrompt,
    createUserPrompt,
    createQuestionInstruction,
} from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';
import { fileStore, AllowedFiles } from '../storage/index.ts';
import { parseResponse } from '../commons/response.ts';
import { weatherToolOllama, getWeather, formatWeatherData } from '../tools/weather.ts';

type AskParams = {
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    userName: string;
    userQuestion: string;
};

export async function ask(params: AskParams): Promise<{ response: string; memory: string }> {
    const { guildId, channelName, conversationContext, userName, userQuestion } = params;

    const systemPrompt = await createSystemPrompt(guildId);
    const instruction = createQuestionInstruction(userName, userQuestion);
    const userPrompt = await createUserPrompt(
        channelName,
        conversationContext,
        instruction,
        guildId,
    );

    let response = await ollama.chat({
        model: DEFAULT_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        tools: [weatherToolOllama],
    });

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            response.message,
        ];

        for (const tool of response.message.tool_calls) {
            if (tool.function.name === 'get_weather') {
                try {
                    const { city } = tool.function.arguments as { city: string };
                    const weatherData = await getWeather(city);
                    messages.push({ role: 'tool', content: formatWeatherData(weatherData) });
                } catch (error) {
                    messages.push({
                        role: 'tool',
                        content: `Erreur lors de la récupération de la météo: ${(error as Error).message}`,
                    });
                }
            }
        }

        response = await ollama.chat({
            model: DEFAULT_MODEL,
            messages: messages,
            tools: [weatherToolOllama],
        });
    }

    const { response: botResponse, memory: botMemory } = parseResponse(
        response.message.content ?? '',
    );

    if (botMemory) {
        try {
            await fileStore.writeText(guildId, AllowedFiles.MEMORY, botMemory);
            console.log(`[Memory] Updated | guildId=${guildId}`);
        } catch (error) {
            console.error(`[Memory] Error writing | guildId=${guildId}`, error);
        }
    }

    return { response: botResponse, memory: botMemory };
}
