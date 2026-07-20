import { pingCommand } from './ping.ts';
import { askCommand } from './ask.ts';
import { leaderboardCommand } from './leaderboard.ts';
import { shellsCommand } from './shells.ts';
import { shopCommand } from './shop.ts';
import { heatCommand } from './heat.ts';
import type { Command } from './types.ts';

export const commands: Command[] = [
    pingCommand,
    askCommand,
    leaderboardCommand,
    shellsCommand,
    shopCommand,
    heatCommand,
];
