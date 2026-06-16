import type { ShellsUser, UserUpgrades } from '../commons/types.js';
import type { BigNum } from '../commons/big-number.js';
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
    getCost: (currentLevel: number) => BigNum;
    getGain: (currentLevel: number) => BigNum;
    formatGain?: (currentLevel: number) => string;
};

export type AdditiveUpgradeDefinition = UpgradeDefinitionBase & {
    kind: UpgradeKind.ADDITIVE;
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
    shells: BigNum;
    maxShells: BigNum;
    shellsPerMessage: BigNum;
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
