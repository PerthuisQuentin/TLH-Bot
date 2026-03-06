import { InteractionResponseType } from 'discord-interactions';
import {
  createMessageBody,
  updateInteractionResponse,
  DiscordRequest,
} from '../commons/utils.js';
import { CONTEXT_MESSAGES_LIMIT } from '../commons/prompts.js';
import { formatMessagesContext } from '../commons/messages.js';
import { ask } from '../ollama/ask-ollama.js';

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

    // Ask Ollama with context and tools
    const { response: botResponse } = await ask({
      guildId,
      channelName,
      conversationContext,
      userName,
      userQuestion,
    });

    // Edit the response with only the bot response (without memory section)
    const interactionToken = req.body.token;

    const updatedMessage = await updateInteractionResponse(
      interactionToken,
      createMessageBody(
        `**Question de ${userName} :** ${userQuestion}\n\n${botResponse}`,
      ),
    );

    const logTimestamp = new Date().toISOString();
    const questionPreview = (userQuestion || '').substring(0, 20);
    console.log(
      `Bot message posted | channel=${channelId} | id=${updatedMessage?.id} | date=${logTimestamp} | question="${questionPreview}"`,
    );
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
