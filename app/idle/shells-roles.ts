import { readJsonFileSync, AllowedFiles } from '../commons/files.js';
import { memoryCache } from '../commons/memory.js';
import type { GuildMember } from 'discord.js';
import type { RoleChanges } from './types.js';

interface ShellsRoleConfig {
    roleId: string;
    threshold: number;
}

interface GuildConfig {
    shellsRoles?: ShellsRoleConfig[];
}

const CONFIG_CACHE_TTL = 60;

export function getShellsRolesConfig(guildId: string): ShellsRoleConfig[] {
    const cacheKey = `shellsRoles:${guildId}`;

    const cached = memoryCache.get<ShellsRoleConfig[]>(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const config = readJsonFileSync<GuildConfig>(guildId, AllowedFiles.CONFIG, {});
    const shellsRoles = config.shellsRoles ?? [];
    const sortedRoles = [...shellsRoles].sort((a, b) => a.threshold - b.threshold);

    memoryCache.set(cacheKey, sortedRoles, CONFIG_CACHE_TTL);

    return sortedRoles;
}

export function getRoleForShells(
    guildId: string,
    shells: number,
): ShellsRoleConfig | null {
    const shellsRoles = getShellsRolesConfig(guildId);
    if (shellsRoles.length === 0) return null;

    let qualifiedRole: ShellsRoleConfig | null = null;
    for (const role of shellsRoles) {
        if (shells >= role.threshold) {
            qualifiedRole = role;
        } else {
            break;
        }
    }
    return qualifiedRole;
}

export async function updateMemberShellsRoles(
    member: GuildMember,
    maxShells: number,
): Promise<RoleChanges> {
    const guildId = member.guild.id;
    const shellsRoles = getShellsRolesConfig(guildId);

    if (shellsRoles.length === 0) {
        return { added: null, addedRoleName: null, removed: [] };
    }

    const shellsRoleIds = shellsRoles.map((r) => r.roleId);
    const targetRole = getRoleForShells(guildId, maxShells);
    const targetRoleId = targetRole?.roleId ?? null;

    const currentShellsRoles = member.roles.cache.filter((role) =>
        shellsRoleIds.includes(role.id),
    );

    const rolesToRemove: string[] = [];
    let roleToAdd: string | null = null;

    if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
        roleToAdd = targetRoleId;
    }

    for (const [roleId] of currentShellsRoles) {
        if (roleId !== targetRoleId) {
            rolesToRemove.push(roleId);
        }
    }

    if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove);
        console.log(
            `[Shells] Role removed | userId=${member.id} | roleIds=${rolesToRemove.join(',')}`,
        );
    }

    let addedRoleName: string | null = null;
    if (roleToAdd) {
        await member.roles.add(roleToAdd);
        const role = member.guild.roles.cache.get(roleToAdd);
        addedRoleName = role?.name ?? null;
        console.log(
            `[Shells] Role added | userId=${member.id} | roleId=${roleToAdd} | roleName=${addedRoleName}`,
        );
    }

    return { added: roleToAdd, addedRoleName, removed: rolesToRemove };
}
