import type { Request, Response } from 'express';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';

export type Command = {
    definition: RESTPostAPIApplicationCommandsJSONBody;
    handler: (req: Request, res: Response) => Promise<unknown>;
}
