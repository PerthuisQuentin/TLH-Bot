import { InteractionResponseType, InteractionType } from 'discord-interactions';
import { commands } from '../commands/index.js';

/**
 * Handles Discord interactions
 */
export async function handleInteraction(req, res) {
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

    // Find and execute the matching command
    const command = commands.find((cmd) => cmd.definition.name === name);

    if (command) {
      return command.handler(req, res);
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
}
