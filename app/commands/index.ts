import { pingCommand } from './ping.js';
import { askCommand } from './ask.js';
import { leaderboardCommand } from './leaderboard.js';
import { shellsCommand } from './shells.js';
import type { Command } from './types.js';

export const commands: Command[] = [pingCommand, askCommand, leaderboardCommand, shellsCommand];
