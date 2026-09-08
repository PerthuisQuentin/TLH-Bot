import { describe, it, expect } from 'vitest';
import { roleForShells, nextRoleAfter, computeRoleChanges } from './shells-roles.ts';
import { bn } from './core/big-number.ts';
import type { ShellsRoleConfig } from '../commons/types.ts';

// Ascending threshold order, the precondition both functions document.
const roles: ShellsRoleConfig[] = [
    { roleId: 'r1', threshold: '100' },
    { roleId: 'r2', threshold: '500' },
    { roleId: 'r3', threshold: '1000' },
];

describe('roleForShells', () => {
    it('returns null below the first threshold', () => {
        expect(roleForShells(roles, bn(50))).toBeNull();
    });

    it('is inclusive at the threshold itself', () => {
        expect(roleForShells(roles, bn(100))?.roleId).toBe('r1');
    });

    it('returns the highest threshold already reached', () => {
        expect(roleForShells(roles, bn(499))?.roleId).toBe('r1');
        expect(roleForShells(roles, bn(500))?.roleId).toBe('r2');
    });

    it('returns the top role above the last threshold', () => {
        expect(roleForShells(roles, bn(1_000_000))?.roleId).toBe('r3');
    });
});

describe('nextRoleAfter', () => {
    it('returns the first role strictly above the balance', () => {
        expect(nextRoleAfter(roles, bn(50))?.roleId).toBe('r1');
        expect(nextRoleAfter(roles, bn(100))?.roleId).toBe('r2');
    });

    it('returns null once the top role is already held', () => {
        expect(nextRoleAfter(roles, bn(1000))).toBeNull();
        expect(nextRoleAfter(roles, bn(1_000_000))).toBeNull();
    });
});

describe('computeRoleChanges', () => {
    it('does nothing when no shells roles are configured', () => {
        expect(computeRoleChanges([], bn(10_000), [])).toEqual({
            addRoleId: null,
            removeRoleIds: [],
        });
    });

    it('adds the qualified role when it is not already held', () => {
        expect(computeRoleChanges(roles, bn(500), [])).toEqual({
            addRoleId: 'r2',
            removeRoleIds: [],
        });
    });

    it('adds nothing when the qualified role is already held', () => {
        expect(computeRoleChanges(roles, bn(500), ['r2'])).toEqual({
            addRoleId: null,
            removeRoleIds: [],
        });
    });

    it('removes a lower shells role that no longer matches', () => {
        expect(computeRoleChanges(roles, bn(500), ['r1'])).toEqual({
            addRoleId: 'r2',
            removeRoleIds: ['r1'],
        });
    });

    it('leaves roles unrelated to the shells tiers untouched', () => {
        expect(computeRoleChanges(roles, bn(500), ['r2', 'some-other-role'])).toEqual({
            addRoleId: null,
            removeRoleIds: [],
        });
    });

    it('strips a held shells role when the balance no longer qualifies for any tier', () => {
        // e.g. thresholds were reconfigured upward after the role was granted.
        expect(computeRoleChanges(roles, bn(10), ['r1'])).toEqual({
            addRoleId: null,
            removeRoleIds: ['r1'],
        });
    });
});
