import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

const TEST_COMMAND = {
  name: 'ping',
  description: 'Ping :)',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const OLLAMA_COMMAND = {
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

const ALL_COMMANDS = [TEST_COMMAND, OLLAMA_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
