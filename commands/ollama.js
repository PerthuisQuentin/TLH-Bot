import { InteractionResponseType } from 'discord-interactions';
import { ollama } from '../commons/ollama.js';
import {
  createMessageBody,
  updateInteractionResponse,
} from '../commons/utils.js';

/**
 * Ollama command definition
 */
export const OLLAMA_COMMAND = {
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
};

/**
 * Handles the ollama command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleOllamaCommand(req, res) {
  const { data } = req.body;

  // Get the user's question
  const userQuestion = data.options?.find(
    (opt) => opt.name === 'question'
  )?.value;

  // Respond immediately to Discord to avoid timeout
  res.send({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });

  try {
    const response = await ollama.chat({
      model: 'gemini-3-flash-preview:cloud',
      messages: [
        {
          role: 'system',
          content:
            'Tu es un assistant qui répond dans un message Discord. Privilégie des réponses courtes, claires et concises. Évite les réponses trop longues qui dépasseraient la limite de Discord.',
        },
        { role: 'user', content: userQuestion },
      ],
    });

    // Edit the response with Ollama's result
    const interactionToken = req.body.token;

    await updateInteractionResponse(
      interactionToken,
      createMessageBody(
        `**Question:** ${userQuestion}\n\n${response.message.content}`
      )
    );
  } catch (error) {
    const interactionToken = req.body.token;

    await updateInteractionResponse(
      interactionToken,
      createMessageBody('Une erreur est survenue lors de la requête Ollama.')
    );
  }
}
