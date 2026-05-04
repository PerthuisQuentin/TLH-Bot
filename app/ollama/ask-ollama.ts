import { ollama, DEFAULT_MODEL } from './ollama.js';
import { createSystemPrompt, createUserPrompt, createQuestionInstruction } from '../commons/prompts.js';
import { writeFileContent, AllowedFiles } from '../commons/files.js';
import { parseResponse } from '../commons/response.js';
import {
    weatherToolOllama,
    getWeather,
    formatWeatherData,
} from '../tools/weather.js';
import {
    reminderToolOllama,
    createReminder,
    formatReminderResponse,
} from '../tools/reminder.js';

interface AskParams {
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
        tools: [weatherToolOllama, reminderToolOllama],
    });

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            response.message as unknown as { role: string; content: string },
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
            } else if (tool.function.name === 'create_reminder') {
                try {
                    const { question, reminder_date } = tool.function.arguments as {
                        question: string;
                        reminder_date: string;
                    };
                    const reminder = await createReminder(
                        guildId,
                        userId,
                        channelId,
                        question,
                        reminder_date,
                    );
                    messages.push({ role: 'tool', content: formatReminderResponse(reminder) });
                } catch (error) {
                    messages.push({
                        role: 'tool',
                        content: `Erreur lors de la création du rappel: ${(error as Error).message}`,
                    });
                }
            }
        }

        response = await ollama.chat({
            model: DEFAULT_MODEL,
            messages: messages as Parameters<typeof ollama.chat>[0]['messages'],
            tools: [weatherToolOllama, reminderToolOllama],
        });
    }

    const { response: botResponse, memory: botMemory } = parseResponse(
        response.message.content ?? '',
    );

    if (botMemory) {
        try {
            await writeFileContent(guildId, AllowedFiles.MEMORY, botMemory);
            console.log(`[Memory] Updated | guildId=${guildId}`);
        } catch (error) {
            console.error(`[Memory] Error writing | guildId=${guildId}`, error);
        }
    }

    return { response: botResponse, memory: botMemory };
}
