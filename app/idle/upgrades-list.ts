import type { AdditiveUpgradeDefinition, MultiplicativeUpgradeDefinition, UpgradeDefinition } from './types.js';
import { UpgradeKind } from './types.js';
import { bnAdd, bnMul, bnPow, formatBigNum } from '../commons/big-number.js';

// For an additive upgrade, the gain is simply the sum of all previous levels' gains.
function additiveValueAtLevel(initialValue: number, increment: number, currentLevel: number) {
    return bnAdd(initialValue, bnMul(increment, currentLevel));
}

// For an additive upgrade with an interval-based multiplier, the gain is the sum of all previous levels' gains, with an extra multiplier applied every intervalSize levels.
function intervalAdditiveValue(
    currentLevel: number,
    baseValue: number,
    increment: number,
    intervalSize: number,
    intervalMultiplier: number,
) {
    const intervalSteps = Math.floor(currentLevel / Math.max(1, intervalSize));
    return bnMul(
        additiveValueAtLevel(baseValue, increment, currentLevel),
        currentLevel >= intervalSize ? bnMul(intervalMultiplier, intervalSteps) : 1,
    );
}

// Simple geometric progression at one level: base * multiplier^level.
function geometricValueAtLevel(initialValue: number, multiplier: number, currentLevel: number) {
    return bnMul(initialValue, bnPow(multiplier, currentLevel));
}

// Geometric progression with an extra multiplier applied every intervalSize levels.
// value = baseValue * levelMultiplier^level * intervalMultiplier^floor(level/intervalSize)
function intervalGeometricValue(
    currentLevel: number,
    baseValue: number,
    levelMultiplier: number,
    intervalSize: number,
    intervalMultiplier: number,
) {
    const intervalSteps = Math.floor(currentLevel / Math.max(1, intervalSize));
    return bnMul(
        geometricValueAtLevel(baseValue, levelMultiplier, currentLevel),
        bnPow(intervalMultiplier, intervalSteps),
    );
}

export const DIVING_OTTERS_UPGRADE: AdditiveUpgradeDefinition = {
    id: 'divingOtters',
    kind: UpgradeKind.ADDITIVE,
    name: 'Loutres plongeuses',
    emoji: '🦦',
    description: 'Envoyez des loutres plonger pour ramasser des coquillages à votre place. Chaque loutre supplémentaire gonfle votre récolte.',
    getCost(currentLevel) {
        return intervalGeometricValue(currentLevel, 1000, 1.2, 10, 2);
    },
    getGain(currentLevel) {
        return intervalAdditiveValue(currentLevel, 0, 1, 10, 2);
    },
    formatGain(currentLevel) {
        return `+${formatBigNum(this.getGain(currentLevel))} 🐚/msg`;
    },
};

export const HYDRODYNAMIC_FLIPPERS_UPGRADE: MultiplicativeUpgradeDefinition = {
    id: 'hydrodynamicFlippers',
    kind: UpgradeKind.MULTIPLICATIVE,
    name: 'Nageoires hydrodynamiques',
    emoji: '🐟',
    description: 'Des nageoires perfectionnées décuplent l\'efficacité de vos loutres. Chaque amélioration amplifie la récolte de toute la troupe.',
    getCost(currentLevel) {
        return intervalGeometricValue(currentLevel, 15000, 1.3, 10, 5);
    },
    getGain(currentLevel) {
        return geometricValueAtLevel(1, 1.15, currentLevel);
    },
    formatGain(currentLevel) {
        return `×${formatBigNum(this.getGain(currentLevel))}`;
    },
};

export const HARVEST_BAGS_UPGRADE: MultiplicativeUpgradeDefinition = {
    id: 'harvestBags',
    kind: UpgradeKind.MULTIPLICATIVE,
    name: 'Sacs de récolte XXL',
    emoji: '🎒',
    description: 'Des sacs plus grands permettent à vos loutres de rapporter bien plus à chaque plongée. Chaque amélioration augmente la récolte de +50%.',
    getCost(currentLevel) {
        return intervalGeometricValue(currentLevel, 100000, 2, 10, 10);
    },
    getGain(currentLevel) {
        return geometricValueAtLevel(1, 1.5, currentLevel);
    },
    formatGain(currentLevel) {
        return `×${formatBigNum(this.getGain(currentLevel))}`;
    },
};

export const ALL_UPGRADES: UpgradeDefinition[] = [DIVING_OTTERS_UPGRADE, HYDRODYNAMIC_FLIPPERS_UPGRADE, HARVEST_BAGS_UPGRADE];
