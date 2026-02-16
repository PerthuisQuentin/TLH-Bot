import { InteractionResponseType } from 'discord-interactions';
import { ollama } from '../commons/ollama.js';
import {
  createMessageBody,
  updateInteractionResponse,
  DiscordRequest,
} from '../commons/utils.js';
import {
  createSystemPrompt,
  CONTEXT_MESSAGES_LIMIT,
  createUserPrompt,
} from '../commons/prompts.js';
import { formatMessagesContext } from '../commons/messages.js';
import {
  readFileContent,
  writeFileContent,
  AllowedFiles,
} from '../commons/files.js';

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
 * Handles the ollama command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleOllamaCommand(req, res) {
  const { data } = req.body;
  const guildId = req.body.guild_id || 'dm';

  // Get the user's question
  const userQuestion = data.options?.find(
    (opt) => opt.name === 'question',
  )?.value;

  // Respond immediately to Discord to avoid timeout
  res.send({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });

  try {
    // Get user name early
    const userName =
      req.body.member?.nick ||
      req.body.member?.user?.global_name ||
      req.body.member?.user?.username ||
      req.body.user?.global_name ||
      req.body.user?.username;

    // Fetch previous messages for context
    const channelId = req.body.channel_id;
    let conversationContext = '';
    let channelName = 'canal inconnu';

    try {
      // Get channel information
      const channelResponse = await DiscordRequest(`channels/${channelId}`, {
        method: 'GET',
      });
      const channelData = await channelResponse.json();
      channelName = channelData.name || 'canal inconnu';

      const messagesResponse = await DiscordRequest(
        `channels/${channelId}/messages?limit=${CONTEXT_MESSAGES_LIMIT}`,
        { method: 'GET' },
      );
      const messages = await messagesResponse.json();

      // Format messages for context
      conversationContext = formatMessagesContext(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      // Continue without context if fetching fails
    }

    // Build user prompt with context and question
    const userPrompt = await createUserPrompt(
      channelName,
      conversationContext,
      userName,
      userQuestion,
      guildId,
    );

    const response = await ollama.chat({
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
    });

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

    // Edit the response with only the bot response (without memory section)
    const interactionToken = req.body.token;

    const updatedMessage = await updateInteractionResponse(
      interactionToken,
      createMessageBody(
        `**Question de ${userName} :** ${userQuestion}\n\n${botResponse}`,
      ),
    );

    console.log('Bot message posted with ID:', updatedMessage?.id);
  } catch (error) {
    const interactionToken = req.body.token;

    await updateInteractionResponse(
      interactionToken,
      createMessageBody('Une erreur est survenue lors de la requête Ollama.'),
    );
  }
}

export const ollamaCommand = {
  definition: {
    name: 'ollama',
    description: 'Pose une question à Ollama',
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        type: 3,
        name: 'question',
        description: 'La question à poser',
        required: true,
      },
    ],
  },
  handler: handleOllamaCommand,
};
