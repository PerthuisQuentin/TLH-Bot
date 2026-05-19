import type { AdditiveUpgradeDefinition, MultiplicativeUpgradeDefinition } from './types.js';
import { UpgradeKind } from './types.js';

export const DIVING_OTTERS_UPGRADE: AdditiveUpgradeDefinition = {
    id: 'divingOtters',
    kind: UpgradeKind.ADDITIVE,
    name: 'Loutres plongeuses',
    emoji: '🦦',
    description: 'Envoyez des loutres plonger pour ramasser des coquillages à votre place. Chaque loutre supplémentaire gonfle votre récolte.',
    initialCost: 1000,
    costMultiplier: 1.2,
    baseGain: 1,
    gainDoublingInterval: 10,
};

export const HYDRODYNAMIC_FLIPPERS_UPGRADE: MultiplicativeUpgradeDefinition = {
    id: 'hydrodynamicFlippers',
    kind: UpgradeKind.MULTIPLICATIVE,
    name: 'Nageoires hydrodynamiques',
    emoji: '🐟',
    description: 'Des nageoires perfectionnées décuplent l\'efficacité de vos loutres. Chaque amélioration amplifie la récolte de toute la troupe.',
    initialCost: 15000,
    costMultiplier: 1.25,
    baseGain: 1.15,
};
