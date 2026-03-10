import { client } from '../../bot.js';

/**
 * Lists all roles of a guild
 * GET /guilds/:guildId/roles
 */
export async function listRoles(req, res) {
  const { guildId } = req.params;

  if (!guildId) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send('Missing guildId');
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const roles = await guild.roles.fetch();

    const roleList = roles
      .map((role) => ({
        id: role.id,
        name: role.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ roles: roleList }));
  } catch (error) {
    console.error(`[API] Error listing roles | guildId=${guildId}`, error);

    if (error.code === 10004) {
      return res
        .status(404)
        .set('Content-Type', 'text/plain')
        .send('Guild not found');
    }

    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send('Failed to list roles');
  }
}
