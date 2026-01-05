import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseType,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { handlePingCommand } from './commands/ping.js';
import { handleOllamaCommand } from './commands/ollama.js';

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
        return handlePingCommand(req, res);
      }

      if (name === 'ollama') {
        return handleOllamaCommand(req, res);
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
