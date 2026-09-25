import type { Request, Response } from 'express';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10';

export type Command = {
    definition: RESTPostAPIApplicationCommandsJSONBody;
    handler: (req: Request, res: Response) => Promise<unknown>;
    /** Clicks on the components this command drew, `action` being its half of the custom_id. */
    onComponent?: (req: Request, res: Response, action: string) => Promise<unknown>;
};
