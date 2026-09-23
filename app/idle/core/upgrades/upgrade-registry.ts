import type { BaseUpgrade, UpgradeMeta } from './base-upgrade.ts';
import { UpgradeId } from '../types.ts';
import { DivingOttersUpgrade } from './diving-otters.ts';
import { HydrodynamicFlippersUpgrade } from './hydrodynamic-flippers.ts';
import { HarvestBagsUpgrade } from './harvest-bags.ts';
import { NourishingReefUpgrade } from './nourishing-reef.ts';
import { BuildingPolypsUpgrade } from './building-polyps.ts';
import { CoralSeedlingUpgrade } from './coral-seedling.ts';
import { MillennialShellUpgrade } from './millennial-shell.ts';

type UpgradeConstructor = (new (level: number) => BaseUpgrade) & UpgradeMeta;

export const UPGRADE_REGISTRY: Record<UpgradeId, UpgradeConstructor> = {
    [UpgradeId.DIVING_OTTERS]: DivingOttersUpgrade,
    [UpgradeId.HYDRODYNAMIC_FLIPPERS]: HydrodynamicFlippersUpgrade,
    [UpgradeId.HARVEST_BAGS]: HarvestBagsUpgrade,
    [UpgradeId.CORAL_SEEDLING]: CoralSeedlingUpgrade,
    [UpgradeId.NOURISHING_REEF]: NourishingReefUpgrade,
    [UpgradeId.BUILDING_POLYPS]: BuildingPolypsUpgrade,
    [UpgradeId.MILLENNIAL_SHELL]: MillennialShellUpgrade,
};

export const ALL_UPGRADE_CLASSES: UpgradeConstructor[] = Object.values(UPGRADE_REGISTRY);

export const ALL_UPGRADE_IDS: UpgradeId[] = Object.keys(UPGRADE_REGISTRY) as UpgradeId[];
