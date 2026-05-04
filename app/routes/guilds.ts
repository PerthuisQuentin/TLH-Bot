import type { Request, Response } from 'express';
import { client } from '../../bot.js';

export async function listRoles(req: Request, res: Response): Promise<void> {
    const guildId = req.params.guildId as string;

    if (!guildId) {
        res.status(400).set('Content-Type', 'text/plain').send('Missing guildId');
        return;
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        const roles = await guild.roles.fetch();

        const roleList = roles
            .map((role) => ({ id: role.id, name: role.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

        res.set('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify({ roles: roleList }));
    } catch (err) {
        const error = err as { code?: number };
        console.error(`[API] Error listing roles | guildId=${guildId}`, err);

        if (error.code === 10004) {
            res.status(404).set('Content-Type', 'text/plain').send('Guild not found');
            return;
        }

        res.status(500).set('Content-Type', 'text/plain').send('Failed to list roles');
    }
}
