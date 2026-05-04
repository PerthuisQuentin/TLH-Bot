import 'dotenv/config';
import { InstallGlobalCommands } from './app/commons/utils.js';
import { commands } from './app/commands/index.js';

const commandDefinitions = commands.map((cmd) => cmd.definition);

InstallGlobalCommands(process.env.APP_ID, commandDefinitions);
