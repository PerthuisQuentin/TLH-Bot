import type { ShellsUser, UserUpgrades } from '../commons/types.js';
export type { ShellsUser, UserUpgrades };

export enum UpgradeKind {
    ADDITIVE = 'additive',
    MULTIPLICATIVE = 'multiplicative',
}

type UpgradeDefinitionBase = {
    id: string;
    name: string;
    emoji: string;
    description: string;
    initialCost: number;
    costMultiplier: number;
    baseGain: number;
};

export type AdditiveUpgradeDefinition = UpgradeDefinitionBase & {
    kind: UpgradeKind.ADDITIVE;
    gainDoublingInterval: number;
};

export type MultiplicativeUpgradeDefinition = UpgradeDefinitionBase & {
    kind: UpgradeKind.MULTIPLICATIVE;
};

export type UpgradeDefinition = AdditiveUpgradeDefinition | MultiplicativeUpgradeDefinition;

export type RoleChanges = {
    added: string | null;
    addedRoleName: string | null;
    removed: string[];
}

export type LeaderboardEntry = {
    rank: number;
    shells: number;
    maxShells: number;
    userId: string;
}

export type PaginatedLeaderboard = {
    users: ShellsUser[];
    totalUsers: number;
    totalPages: number;
    currentPage: number;
    startIndex: number;
    pageSize: number;
}
