import type { Request, Response } from 'express';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';

export interface Command {
    definition: RESTPostAPIApplicationCommandsJSONBody;
    handler: (req: Request, res: Response) => Promise<unknown>;
}
