import 'dotenv/config';
import { InstallGlobalCommands } from './commons/utils.js';
import { commands } from './commands/index.js';

const commandDefinitions = commands.map((cmd) => cmd.definition);

InstallGlobalCommands(process.env.APP_ID, commandDefinitions);
