import { readJsonFileSync, writeJsonFileSync, AllowedFiles } from '../commons/files.js';
import type { UserUpgrades } from './types.js';

export function readUpgradesData(guildId: string): UserUpgrades[] {
    return readJsonFileSync(guildId, AllowedFiles.UPGRADES);
}

export function writeUpgradesData(guildId: string, data: UserUpgrades[]): void {
    writeJsonFileSync(guildId, AllowedFiles.UPGRADES, data);
}

export function getUserUpgrades(guildId: string, userId: string): UserUpgrades {
    const data = readUpgradesData(guildId);
    const found = data.find((u) => u.userId === userId);
    return {
        userId,
        divingOtters: found?.divingOtters ?? 0,
        hydrodynamicFlippers: found?.hydrodynamicFlippers ?? 0,
        harvestBags: found?.harvestBags ?? 0,
    };
}

export function writeUserUpgrades(guildId: string, upgrades: UserUpgrades): void {
    const data = readUpgradesData(guildId);
    const index = data.findIndex((u) => u.userId === upgrades.userId);

    if (index === -1) {
        data.push(upgrades);
    } else {
        data[index] = upgrades;
    }

    writeUpgradesData(guildId, data);
}

export function incrementUserUpgrade(
    guildId: string,
    userId: string,
    upgradeId: keyof Omit<UserUpgrades, 'userId'>,
    count: number,
): UserUpgrades {
    const upgrades = getUserUpgrades(guildId, userId);
    upgrades[upgradeId] += count;
    writeUserUpgrades(guildId, upgrades);
    return upgrades;
}
