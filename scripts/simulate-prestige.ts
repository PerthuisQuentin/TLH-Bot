/**
 * Prestige loop simulation, on top of the shell tree simulated by `simulate-idle.ts`.
 *
 *   tsx scripts/simulate-prestige.ts [--days=365] [--messages-per-day=200]
 *                                    [--strategy=cheapest|best-payback|best-affordable-payback] [--prestige-ratio=2]
 *                                    [--sessions=1] [--no-octopus]
 *
 * Everything the game has an opinion on is read from `app/idle/core/`: the coral formula,
 * the two coral upgrades and what a reset does. The script owns the one thing the game does
 * not decide, which is when a player chooses to prestige, and the naive buying that stands in
 * for a player. The design it serves is docs/prestige-design.md.
 */

import { GameInstance } from '../app/idle/core/game-instance.ts';
import { ResourceId, UpgradeId } from '../app/idle/core/types.ts';
import { bn, bnAdd, bnGte, bnMul, formatBigNum, type BigNum } from '../app/idle/core/big-number.ts';
import { numberArg, playMessages, spendCoral, table, tryBuy, strategyArg } from './sim-common.ts';
import { PurchaseStrategy } from '../app/idle/core/purchase-planner.ts';

type SimulationConfig = {
    days: number;
    messagesPerDay: number;
    strategy: PurchaseStrategy;
    /** Prestige once the run is worth this many times the coral earned so far. */
    prestigeRatio: number;
    /**
     * Slices of the day's messages. The Pieuvre intendante buys after each one, the player by
     * hand once, at the end of the day: more sessions is what the automation is worth.
     */
    sessions: number;
    /** A player who never buys the Pieuvre, the baseline its coral price is measured against. */
    octopus: boolean;
};

const DEFAULT_CONFIG: SimulationConfig = {
    days: 365,
    messagesPerDay: 200,
    strategy: PurchaseStrategy.CHEAPEST,
    prestigeRatio: 2,
    sessions: 1,
    octopus: true,
};

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): SimulationConfig {
    const config = { ...DEFAULT_CONFIG };

    for (const arg of argv) {
        const strategy = strategyArg(arg);
        if (strategy !== null) {
            config.strategy = strategy;
            continue;
        }

        const days = numberArg(arg, '--days=');
        if (days !== null && days > 0) {
            config.days = Math.floor(days);
            continue;
        }

        const messages = numberArg(arg, '--messages-per-day=');
        if (messages !== null && messages > 0) {
            config.messagesPerDay = messages;
            continue;
        }

        if (arg === '--no-octopus') {
            config.octopus = false;
            continue;
        }

        const sessions = numberArg(arg, '--sessions=');
        if (sessions !== null && sessions >= 1) {
            config.sessions = Math.floor(sessions);
            continue;
        }

        const ratio = numberArg(arg, '--prestige-ratio=');
        if (ratio !== null && ratio > 0) config.prestigeRatio = ratio;
    }

    return config;
}

// ─── The player's two choices ────────────────────────────────────────────────

function newPlayer(): GameInstance {
    return new GameInstance({
        userId: 'sim',
        resources: { [ResourceId.SHELLS]: '0' },
        stats: { maxShells: '0' },
        growthRings: { days: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
        autoBuyEnabled: true,
        upgrades: {},
    });
}

// ─── Simulation ──────────────────────────────────────────────────────────────

type Prestige = {
    index: number;
    day: number;
    runLength: number;
    runPeak: BigNum;
    otters: number;
    gained: BigNum;
    earned: BigNum;
    reef: number;
    reefMultiplier: BigNum;
    polyps: number;
    coralMultiplier: BigNum;
};

function run(config: SimulationConfig): {
    prestiges: Prestige[];
    instance: GameInstance;
    capLiftedDay: number | null;
    octopusDays: number[];
} {
    const instance = newPlayer();
    const skip = config.octopus ? [] : [UpgradeId.STEWARD_OCTOPUS];
    const octopusDays: number[] = [];
    let coralEarned = bn(0);
    let runStart = 1;
    const prestiges: Prestige[] = [];
    let capLiftedDay: number | null = null;

    for (let day = 1; day <= config.days; day += 1) {
        for (let session = 0; session < config.sessions; session += 1) {
            playMessages(instance, day, config.messagesPerDay / config.sessions);
            instance.runAutoBuy();
        }
        while (tryBuy(instance, config.strategy, skip) !== null);
        capLiftedDay ??= instance.growthRingsCapLifted ? day : null;

        const runPeak = instance.stats.runMaxShells;
        const preview = instance.previewPrestige();
        if (!preview.canPrestige) continue;
        if (!bnGte(preview.coral, bnMul(coralEarned, config.prestigeRatio))) continue;

        const otters = instance.upgrades[UpgradeId.DIVING_OTTERS].level;
        const outcome = instance.prestige();
        if (!outcome) continue;

        coralEarned = bnAdd(coralEarned, outcome.coral);
        // After the reset, so a level bought now only pays from the next run on. That is
        // what the player gets: prestige first, then walk into the shop.
        spendCoral(instance, skip);
        capLiftedDay ??= instance.growthRingsCapLifted ? day : null;
        while (octopusDays.length < instance.upgrades[UpgradeId.STEWARD_OCTOPUS].level) {
            octopusDays.push(day);
        }

        const reef = instance.upgrades[UpgradeId.NOURISHING_REEF];
        prestiges.push({
            index: prestiges.length + 1,
            day,
            runLength: day - runStart + 1,
            runPeak,
            otters,
            gained: outcome.coral,
            earned: coralEarned,
            reef: reef.level,
            reefMultiplier: reef.getGain(),
            polyps: instance.upgrades[UpgradeId.BUILDING_POLYPS].level,
            coralMultiplier: instance.coralMultiplier,
        });
        runStart = day + 1;
    }

    return { prestiges, instance, capLiftedDay, octopusDays };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function main(): void {
    const config = parseArgs(process.argv.slice(2));
    const { prestiges, instance, capLiftedDay, octopusDays } = run(config);

    console.log('══ Prestige loop ══');
    console.log(
        `${config.days} days · ${config.messagesPerDay} effective msg/day in ${config.sessions} session(s) · strategy ${config.strategy} · prestige at ${config.prestigeRatio}x lifetime coral${config.octopus ? '' : ' · no Pieuvre intendante'}`,
    );
    console.log('Curves, coral formula and reset all read from app/idle/core/.\n');

    if (prestiges.length === 0) {
        console.log('No prestige reached over that horizon.');
        return;
    }

    console.log(
        table(
            [
                'Prestige',
                'Day',
                'Run len',
                'Run peak',
                'Otters',
                'Coral +',
                'Coral tot',
                'Reef',
                'Reef mult',
                'Polyps',
                'Coral x',
            ],
            prestiges.map((p) => [
                String(p.index),
                String(p.day),
                String(p.runLength),
                formatBigNum(p.runPeak),
                String(p.otters),
                p.gained.toFixed(0),
                p.earned.toFixed(0),
                String(p.reef),
                `x${formatBigNum(p.reefMultiplier)}`,
                String(p.polyps),
                `x${formatBigNum(p.coralMultiplier)}`,
            ]),
        ),
    );

    const lengths = prestiges.map((p) => p.runLength);
    const last = prestiges[prestiges.length - 1];
    console.log(
        `\n${prestiges.length} prestiges · ${last.earned.toFixed(0)} coral earned · reef ${last.reef} (x${formatBigNum(last.reefMultiplier)}) · polyps ${last.polyps} (x${formatBigNum(last.coralMultiplier)} coral)`,
    );
    console.log(
        `First prestige day ${prestiges[0].day} · run length ${lengths[0]} → ${lengths[lengths.length - 1]} days · income now ${formatBigNum(instance.income[ResourceId.SHELLS])} 🐚/msg`,
    );
    console.log(
        `Growth rings ${instance.growthRings.days} days (x${instance.growthRingsMultiplier.toFixed(2)}) · cap lifted ${capLiftedDay === null ? 'never' : `day ${capLiftedDay}`}`,
    );
    console.log(
        `Pieuvre intendante levels bought on days ${octopusDays.length === 0 ? 'never' : octopusDays.join(', ')}`,
    );
}

main();
