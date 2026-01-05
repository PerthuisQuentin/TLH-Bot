import 'dotenv/config';
import { InstallGlobalCommands } from './commons/utils.js';
import { PING_COMMAND } from './commands/ping.js';
import { OLLAMA_COMMAND } from './commands/ollama.js';

const ALL_COMMANDS = [PING_COMMAND, OLLAMA_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
