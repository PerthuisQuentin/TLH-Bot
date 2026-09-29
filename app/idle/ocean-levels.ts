import type { OceanLevels } from '../ocean/types.ts';
import { bnGte, type BigNum } from './core/big-number.ts';
import type { ReadonlyGameInstance } from './core/game-instance.ts';
import { ResourceId, UpgradeId } from './core/types.ts';

// Which game state draws what in the `/shells` ocean. A level is the number of thresholds
// reached. The tiers follow `scripts/simulate-prestige.ts` at 200 msg/day, see
// docs/shells.md, Ocean scene. The scene shows the moment: the run's upgrades and the balance
// go back to zero at a prestige, and the picture with them. Only the kelp and the reef,
// which read counters that never drop, keep growing across runs.

/** Diving otters level: the first diver at level 1, the tenth late in a strong run. */
const OTTER_TIERS = [1, 5, 10, 20, 35, 55, 80, 120, 180, 260];

/** Flippers run at about half the otters' level. */
const BUBBLE_TIERS = [1, 3, 6, 10, 16, 25, 40, 60, 90, 130];

const BAG_TIERS = [1, 10, 30];

/** Shells balance. Widening gaps: an early run climbs a tier every few days, a late one in hours. */
const SHELL_TIERS = ['10', '1e3', '1e5', '1e7', '1e10', '1e14', '1e19', '1e25', '1e32', '1e40'];

/** Growth ring days over a year, closer together early so a newcomer sees the first stalk within days. */
const KELP_TIERS = [3, 7, 14, 30, 60, 100, 150, 210, 280, 365];

/** Coral ever earned, for the nine levels after the seedling's own. */
const CORAL_TIERS = ['1', '3', '10', '30', '100', '1e3', '1e5', '1e8', '1e12'];

function tierOf(value: number, tiers: readonly number[]): number {
    return tiers.filter((t) => value >= t).length;
}

function bigTierOf(value: BigNum, tiers: readonly string[]): number {
    return tiers.filter((t) => bnGte(value, t)).length;
}

export function oceanLevelsFor(instance: ReadonlyGameInstance): OceanLevels {
    const level = (id: UpgradeId) => instance.upgrades[id].level;
    return {
        otters: tierOf(level(UpgradeId.DIVING_OTTERS), OTTER_TIERS),
        bubbles: tierOf(level(UpgradeId.HYDRODYNAMIC_FLIPPERS), BUBBLE_TIERS),
        bags: tierOf(level(UpgradeId.HARVEST_BAGS), BAG_TIERS),
        shells: bigTierOf(instance.resources[ResourceId.SHELLS], SHELL_TIERS),
        kelp: tierOf(instance.growthRings.days, KELP_TIERS),
        // Nothing coral shows before the seedling, which keeps the layer hidden, as the profile does.
        coral: instance.coralUnlocked ? 1 + bigTierOf(instance.stats.totalCoral, CORAL_TIERS) : 0,
        octopus: level(UpgradeId.STEWARD_OCTOPUS),
        nautilus: level(UpgradeId.MILLENNIAL_SHELL) > 0 ? 1 : 0,
    };
}
