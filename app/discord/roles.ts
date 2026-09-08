import type { GuildMember } from 'discord.js';
import type { PendingRoleChanges } from './types.ts';

export async function applyRoleChanges(
    member: GuildMember,
    changes: PendingRoleChanges,
): Promise<string | null> {
    const { addRoleId, removeRoleIds } = changes;

    if (removeRoleIds.length > 0) {
        await member.roles.remove(removeRoleIds);
        console.log(
            `[Shells] Role removed | userId=${member.id} | roleIds=${removeRoleIds.join(',')}`,
        );
    }

    if (addRoleId) {
        await member.roles.add(addRoleId);
        const role = member.guild.roles.cache.get(addRoleId);
        const addedRoleName = role?.name ?? null;
        console.log(
            `[Shells] Role added | userId=${member.id} | roleId=${addRoleId} | roleName=${addedRoleName}`,
        );
        return addedRoleName;
    }

    return null;
}
