import { describe, it, expect, vi } from 'vitest';
import type { GuildMember } from 'discord.js';
import { applyRoleChanges } from './roles.ts';
import type { PendingRoleChanges } from './types.ts';

function mockMember(rolesInCache: Array<{ id: string; name: string }> = []) {
    const add = vi.fn();
    const remove = vi.fn();
    const cache = new Map(rolesInCache.map((r) => [r.id, r]));
    const member = {
        id: 'user-1',
        roles: { add, remove },
        guild: { roles: { cache } },
    } as unknown as GuildMember;
    return { member, add, remove };
}

describe('applyRoleChanges', () => {
    it('calls neither add nor remove, and returns null, when there is nothing to change', async () => {
        const { member, add, remove } = mockMember();
        const changes: PendingRoleChanges = { addRoleId: null, removeRoleIds: [] };

        const result = await applyRoleChanges(member, changes);

        expect(add).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('removes roles without adding any', async () => {
        const { member, add, remove } = mockMember();
        const changes: PendingRoleChanges = { addRoleId: null, removeRoleIds: ['r1', 'r2'] };

        const result = await applyRoleChanges(member, changes);

        expect(remove).toHaveBeenCalledWith(['r1', 'r2']);
        expect(add).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('adds a role and returns its name when it is in the guild cache', async () => {
        const { member, add } = mockMember([{ id: 'r1', name: 'Coquillage d’or' }]);
        const changes: PendingRoleChanges = { addRoleId: 'r1', removeRoleIds: [] };

        const result = await applyRoleChanges(member, changes);

        expect(add).toHaveBeenCalledWith('r1');
        expect(result).toBe('Coquillage d’or');
    });

    it('still adds the role but returns null when it is missing from the guild cache', async () => {
        const { member, add } = mockMember([]);
        const changes: PendingRoleChanges = { addRoleId: 'r1', removeRoleIds: [] };

        const result = await applyRoleChanges(member, changes);

        expect(add).toHaveBeenCalledWith('r1');
        expect(result).toBeNull();
    });

    it('adds and removes together in the same call', async () => {
        const { member, add, remove } = mockMember([{ id: 'r2', name: 'Nouveau rôle' }]);
        const changes: PendingRoleChanges = { addRoleId: 'r2', removeRoleIds: ['r1'] };

        const result = await applyRoleChanges(member, changes);

        expect(remove).toHaveBeenCalledWith(['r1']);
        expect(add).toHaveBeenCalledWith('r2');
        expect(result).toBe('Nouveau rôle');
    });
});
