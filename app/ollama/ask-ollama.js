import { ollama, DEFAULT_MODEL } from './ollama.js';
import { createSystemPrompt, createUserPrompt } from '../commons/prompts.js';
import { writeFileContent, AllowedFiles } from '../commons/files.js';
import { parseResponse } from '../commons/response.js';
import {
  weatherToolOllama,
  getWeather,
  formatWeatherData,
} from '../tools/weather.js';

/**
 * Asks a question to Ollama with context and tool support
 * @param {Object} params - Parameters object
 * @param {string} params.guildId - The guild ID (or 'dm')
 * @param {string} params.userId - The user ID
 * @param {string} params.channelId - The channel ID
 * @param {string} params.channelName - The channel name
 * @param {string} params.conversationContext - The formatted conversation history
 * @param {string} params.userName - The user's name
 * @param {string} params.userQuestion - The user's question
 * @returns {Promise<Object>} Object with { response: string, memory: string }
 */
export async function ask({
  guildId,
  userId,
  channelId,
  channelName,
  conversationContext,
  userName,
  userQuestion,
}) {
  // Build prompts
  const systemPrompt = await createSystemPrompt(guildId);
  const userPrompt = await createUserPrompt(
    channelName,
    conversationContext,
    userName,
    userQuestion,
    guildId,
  );

  // First call to Ollama with tools
  let response = await ollama.chat({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    tools: [weatherToolOllama],
  });

  // Process tool calls
  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
      response.message,
    ];

    for (const tool of response.message.tool_calls) {
      if (tool.function.name === 'get_weather') {
        try {
          const { city } = tool.function.arguments;
          const weatherData = await getWeather(city);
          const formattedWeather = formatWeatherData(weatherData);

          messages.push({
            role: 'tool',
            content: formattedWeather,
          });
        } catch (error) {
          messages.push({
            role: 'tool',
            content: `Erreur lors de la récupération de la météo: ${error.message}`,
          });
        }
      }
    }

    // Make second call with tool results
    response = await ollama.chat({
      model: DEFAULT_MODEL,
      messages: messages,
      tools: [weatherToolOllama],
    });
  }

  // Parse the response to separate the actual response from memory
  const { response: botResponse, memory: botMemory } = parseResponse(
    response.message.content,
  );

  // Save memory if there's new content
  if (botMemory) {
    try {
      await writeFileContent(guildId, AllowedFiles.MEMORY, botMemory);
      console.log('Memory updated successfully');
    } catch (error) {
      console.error('Error writing memory:', error);
    }
  }

  return { response: botResponse, memory: botMemory };
}
