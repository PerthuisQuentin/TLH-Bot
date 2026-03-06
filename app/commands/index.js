import { pingCommand } from './ping.js';
import { ollamaCommand } from './ollama.js';
import { leaderboardCommand } from './leaderboard.js';

/**
 * All available commands
 */
export const commands = [pingCommand, ollamaCommand, leaderboardCommand];
