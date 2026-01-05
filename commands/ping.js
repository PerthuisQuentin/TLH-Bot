import { InteractionResponseType } from 'discord-interactions';
import { createMessageBody } from '../commons/utils.js';

/**
 * Ping command definition
 */
export const PING_COMMAND = {
  name: 'ping',
  description: 'Ping :)',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

/**
 * Handles the ping command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handlePingCommand(req, res) {
  return res.send({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: createMessageBody('Pong !'),
  });
}
