import { ollama } from './ollama.js';
import {
  createSystemPrompt,
  createUserPrompt,
} from '../app/commons/prompts.js';
import { writeFileContent, AllowedFiles } from '../app/commons/files.js';
import {
  weatherTool,
  getWeather,
  formatWeatherData,
} from '../app/tools/weather.js';

/**
 * Parses the bot response to extract the actual response and memory section
 * @param {string} fullResponse - The full response from Ollama
 * @returns {Object} Object with { response: string, memory: string }
 */
function parseResponse(fullResponse) {
  const memoryMarker = '### [MÉMOIRE]';
  const markerIndex = fullResponse.indexOf(memoryMarker);

  if (markerIndex !== -1) {
    const response = fullResponse.substring(0, markerIndex).trim();
    const memory = fullResponse
      .substring(markerIndex + memoryMarker.length)
      .trim();
    return { response, memory };
  }

  // Fallback if marker not found
  return { response: fullResponse, memory: '' };
}

/**
 * Asks a question to Ollama with context and tool support
 * @param {Object} params - Parameters object
 * @param {string} params.guildId - The guild ID (or 'dm')
 * @param {string} params.channelName - The channel name
 * @param {string} params.conversationContext - The formatted conversation history
 * @param {string} params.userName - The user's name
 * @param {string} params.userQuestion - The user's question
 * @returns {Promise<Object>} Object with { response: string, memory: string }
 */
export async function ask({
  guildId,
  channelName,
  conversationContext,
  userName,
  userQuestion,
}) {
  // Build user prompt with context and question
  const userPrompt = await createUserPrompt(
    channelName,
    conversationContext,
    userName,
    userQuestion,
    guildId,
  );

  // First call to Ollama with tools
  let response = await ollama.chat({
    model: 'gemini-3-flash-preview:cloud',
    messages: [
      {
        role: 'system',
        content: await createSystemPrompt(guildId),
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    tools: [weatherTool],
  });

  // Handle tool calls if present
  const messages = [
    {
      role: 'system',
      content: await createSystemPrompt(guildId),
    },
    {
      role: 'user',
      content: userPrompt,
    },
    response.message,
  ];

  // Process tool calls
  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
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
      model: 'gemini-3-flash-preview:cloud',
      messages: messages,
      tools: [weatherTool],
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
