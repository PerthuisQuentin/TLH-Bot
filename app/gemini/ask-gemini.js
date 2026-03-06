import { genai, DEFAULT_MODEL } from './gemini.js';
import { createSystemPrompt, createUserPrompt } from '../commons/prompts.js';
import { writeFileContent, AllowedFiles } from '../commons/files.js';
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

/**
 * Tool definitions for Google GenAI format
 */
const tools = [
  {
    functionDeclarations: [weatherToolGemini, reminderToolGemini],
  },
];

/**
 * Processes a function call from Gemini
 * @param {Object} functionCall - The function call object from Gemini
 * @param {Object} context - Context containing guildId, userId, channelId
 * @returns {Promise<Object>} Function result
 */
async function processFunctionCall(functionCall, context) {
  const { name, args } = functionCall;

  if (name === 'get_weather') {
    try {
      const weatherData = await getWeather(args.city);
      return {
        name,
        response: formatWeatherData(weatherData),
      };
    } catch (error) {
      return {
        name,
        response: `Erreur lors de la récupération de la météo: ${error.message}`,
      };
    }
  } else if (name === 'create_reminder') {
    try {
      const { question, reminder_date } = args;
      const reminder = await createReminder(
        context.guildId,
        context.userId,
        context.channelId,
        question,
        reminder_date,
      );
      return {
        name,
        response: formatReminderResponse(reminder),
      };
    } catch (error) {
      return {
        name,
        response: `Erreur lors de la création du rappel: ${error.message}`,
      };
    }
  }

  return {
    name,
    response: `Fonction inconnue: ${name}`,
  };
}

/**
 * Asks a question to Gemini with context and tool support
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
  // Build user prompt with context and question
  const userPrompt = await createUserPrompt(
    channelName,
    conversationContext,
    userName,
    userQuestion,
    guildId,
  );

  const systemPrompt = await createSystemPrompt(guildId);

  // Create chat with Gemini
  const chat = genai.chats.create({
    model: DEFAULT_MODEL,
    config: {
      systemInstruction: systemPrompt,
      tools,
    },
  });

  // Send the message
  let response = await chat.sendMessage({
    message: userPrompt,
  });

  // Handle function calls if present
  while (response.functionCalls && response.functionCalls.length > 0) {
    const functionResponses = [];

    for (const functionCall of response.functionCalls) {
      const result = await processFunctionCall(functionCall, {
        guildId,
        userId,
        channelId,
      });

      functionResponses.push({
        name: result.name,
        response: result.response,
      });
    }

    // Send function results back to Gemini
    response = await chat.sendMessage({
      message: functionResponses.map((fr) => ({
        functionResponse: {
          name: fr.name,
          response: { result: fr.response },
        },
      })),
    });
  }

  // Get the final text response
  const fullResponse = response.text || '';

  // Parse the response to separate the actual response from memory
  const { response: botResponse, memory: botMemory } =
    parseResponse(fullResponse);

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
