import { fileStore, AllowedFiles } from '../storage/index.ts';
import type { ShellsRoleConfig } from '../commons/types.ts';
import { BigNum, bnFromJSON } from './core/big-number.ts';
import type { PendingRoleChanges } from '../discord/types.ts';

/**
 * The only I/O in this module, and the only place the sort happens — everything
 * below takes the result and stays synchronous. The store already keeps config in
 * RAM, so no extra cache layer here.
 */
export async function getShellsRolesConfig(guildId: string): Promise<ShellsRoleConfig[]> {
    const config = await fileStore.readJson(guildId, AllowedFiles.CONFIG);
    return [...(config.shellsRoles ?? [])].sort((a, b) => {
        const at = bnFromJSON(a.threshold);
        const bt = bnFromJSON(b.threshold);
        return at.lt(bt) ? -1 : at.gt(bt) ? 1 : 0;
    });
}

// The three functions below require `roles` sorted by ascending threshold, which is
// what getShellsRolesConfig returns: both walk the list in order and stop early.

/** Highest tier `shells` qualifies for, or null below the first threshold. */
export function roleForShells(roles: ShellsRoleConfig[], shells: BigNum): ShellsRoleConfig | null {
    let qualifiedRole: ShellsRoleConfig | null = null;
    for (const role of roles) {
        if (shells.gte(bnFromJSON(role.threshold))) {
            qualifiedRole = role;
        } else {
            break;
        }
    }
    return qualifiedRole;
}

/** Cheapest tier still out of reach, or null once the top one is held. */
export function nextRoleAfter(roles: ShellsRoleConfig[], shells: BigNum): ShellsRoleConfig | null {
    return roles.find((role) => bnFromJSON(role.threshold).gt(shells)) ?? null;
}

/**
 * Which shells role to add and which to strip. Only ever touches ids that appear in
 * `roles`, so a member's unrelated roles survive.
 */
export function computeRoleChanges(
    roles: ShellsRoleConfig[],
    maxShells: BigNum,
    currentRoleIds: string[],
): PendingRoleChanges {
    if (roles.length === 0) return { addRoleId: null, removeRoleIds: [] };

    const shellsRoleIds = roles.map((r) => r.roleId);
    const targetRoleId = roleForShells(roles, maxShells)?.roleId ?? null;

    const currentShellsRoleIds = currentRoleIds.filter((id) => shellsRoleIds.includes(id));
    const addRoleId = targetRoleId && !currentRoleIds.includes(targetRoleId) ? targetRoleId : null;
    const removeRoleIds = currentShellsRoleIds.filter((id) => id !== targetRoleId);

    return { addRoleId, removeRoleIds };
}
