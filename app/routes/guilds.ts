import type { Request, Response } from 'express';
import { client } from '../discord/setup.ts';
import { isValidGuildId } from '../storage/index.ts';

export async function listRoles(req: Request, res: Response): Promise<void> {
    const guildId = req.params.guildId as string;

    if (!guildId) {
        res.status(400).set('Content-Type', 'text/plain').send('Missing guildId');
        return;
    }

    // Nothing here touches the filesystem, so this is not the path-traversal guard it is
    // on /api/files — it just keeps a malformed id from reaching discord.js and coming
    // back as a 500, which would blame this service for the caller's bad request.
    if (!isValidGuildId(guildId)) {
        res.status(400).set('Content-Type', 'text/plain').send('Invalid guildId');
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
