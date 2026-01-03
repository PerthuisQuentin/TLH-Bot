import 'dotenv/config';
import express from 'express';
import { Ollama } from 'ollama';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
});

const app = express();
const PORT = process.env.PORT || 3000;

app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  async function (req, res) {
    const { type, data } = req.body;

    if (type === InteractionType.PING) {
      return res.send({ type: InteractionResponseType.PONG });
    }

    /**
     * Handle slash command requests
     * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
     */
    if (type === InteractionType.APPLICATION_COMMAND) {
      const { name } = data;

      if (name === 'ping') {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: 'Pong !',
              },
            ],
          },
        });
      }

      if (name === 'ollama') {
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
          const webhookUrl = `https://discord.com/api/v10/webhooks/${process.env.APP_ID}/${interactionToken}/messages/@original`;

          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              flags: InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: response.message.content,
                },
              ],
            }),
          });
        } catch (error) {
          const interactionToken = req.body.token;
          const webhookUrl = `https://discord.com/api/v10/webhooks/${process.env.APP_ID}/${interactionToken}/messages/@original`;

          await fetch(webhookUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              flags: InteractionResponseFlags.IS_COMPONENTS_V2,
              components: [
                {
                  type: MessageComponentTypes.TEXT_DISPLAY,
                  content: 'Une erreur est survenue lors de la requête Ollama.',
                },
              ],
            }),
          });
        }

        return;
      }

      console.error(`unknown command: ${name}`);
      return res.status(400).json({ error: 'unknown command' });
    }

    console.error('unknown interaction type', type);
    return res.status(400).json({ error: 'unknown interaction type' });
  }
);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
