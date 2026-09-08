/**
 * Idle progression simulation.
 *
 *   tsx scripts/simulate-idle.ts [--days=365] [--messages-per-day=500]
 *                               [--start-shells=0] [--strategy=cheapest]
 *                               [--delay=0] [--every=0]
 *
 * The time unit is a day, and the only input is an effective message count per day.
 * Heat, streak, passive income and the jackpot are deliberately absent: they are
 * folded into that number. The working assumption is ~100 real messages a day which,
 * once the multipliers are applied, earns about what 500 plain messages would.
 *
 * Earnings go through GameInstance.applyShellsGain, so the ±10 % roll is real — it is
 * applied once per simulated day, which is noise on a long run and visible on a short one.
 */

import { GameInstance, DEFAULT_SHELLS_PER_MESSAGE } from '../app/idle/core/game-instance.ts';
import { ALL_UPGRADE_IDS, UPGRADE_REGISTRY } from '../app/idle/core/upgrades/upgrade-registry.ts';
import { ResourceId, UpgradeId, UpgradeKind } from '../app/idle/core/types.ts';
import {
    bn,
    bnAdd,
    bnCeil,
    bnDiv,
    bnGte,
    bnMul,
    bnSub,
    formatBigNum,
    type BigNum,
} from '../app/idle/core/big-number.ts';

type PurchaseStrategy = 'cheapest' | 'best-payback';

type SimulationConfig = {
    days: number;
    messagesPerDay: number;
    startingShells: number;
    strategy: PurchaseStrategy;
    delayMs: number;
    every: number;
};

const DEFAULT_CONFIG: SimulationConfig = {
    days: 365,
    messagesPerDay: 500,
    startingShells: 0,
    strategy: 'cheapest',
    delayMs: 0,
    every: 0,
};

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): SimulationConfig {
    const config = { ...DEFAULT_CONFIG };

    const num = (arg: string, prefix: string): number | null => {
        if (!arg.startsWith(prefix)) return null;
        const value = Number(arg.slice(prefix.length));
        return Number.isFinite(value) ? value : null;
    };

    for (const arg of argv) {
        const days = num(arg, '--days=');
        if (days !== null && days > 0) {
            config.days = Math.floor(days);
            continue;
        }

        const mpd = num(arg, '--messages-per-day=');
        if (mpd !== null && mpd > 0) {
            config.messagesPerDay = mpd;
            continue;
        }

        const start = num(arg, '--start-shells=');
        if (start !== null && start >= 0) {
            config.startingShells = start;
            continue;
        }

        const delay = num(arg, '--delay=');
        if (delay !== null && delay >= 0) {
            config.delayMs = Math.floor(delay);
            continue;
        }

        const every = num(arg, '--every=');
        if (every !== null && every > 0) {
            config.every = Math.floor(every);
            continue;
        }

        if (arg.startsWith('--strategy=')) {
            const value = arg.slice('--strategy='.length).trim().toLowerCase();
            if (value === 'cheapest' || value === 'best-payback') config.strategy = value;
        }
    }

    return config;
}

// ─── Purchases ───────────────────────────────────────────────────────────────

/**
 * Shells income as it would be with one extra level on `bumpId`. GameInstance only
 * computes the income it actually has, and answering "what if" must not mutate it.
 */
function projectedIncome(instance: GameInstance, bumpId?: UpgradeId): BigNum {
    let additive = bn(DEFAULT_SHELLS_PER_MESSAGE);
    let multiplier = bn(1);

    for (const id of ALL_UPGRADE_IDS) {
        const upgrade = instance.upgrades[id];
        if (upgrade.gainResourceId !== ResourceId.SHELLS) continue;
        const gain = upgrade.computeGain(upgrade.level + (id === bumpId ? 1 : 0));
        if (upgrade.kind === UpgradeKind.ADDITIVE) additive = bnAdd(additive, gain);
        else multiplier = bnMul(multiplier, gain);
    }

    return bnMul(additive, multiplier);
}

type Candidate = {
    id: UpgradeId;
    cost: BigNum;
    /** Messages needed to earn the level back. Null when the level adds nothing. */
    payback: BigNum | null;
};

function candidates(instance: GameInstance): Candidate[] {
    const current = instance.income[ResourceId.SHELLS];

    return ALL_UPGRADE_IDS.map((id) => {
        const cost = bnCeil(instance.upgrades[id].getCost());
        const delta = bnSub(projectedIncome(instance, id), current);
        return { id, cost, payback: delta.lte(0) ? null : bnDiv(cost, delta) };
    });
}

/** Buys one level if the strategy finds a target it can afford. */
function tryBuy(instance: GameInstance, strategy: PurchaseStrategy): UpgradeId | null {
    const all = candidates(instance);
    let target: Candidate | undefined;

    if (strategy === 'best-payback') {
        // Best payback overall, affordable or not: waiting for it beats settling
        // for a level that pays itself back more slowly.
        target = all
            .filter((c) => c.payback !== null)
            .sort((a, b) => a.payback!.comparedTo(b.payback!) || a.cost.comparedTo(b.cost))[0];
        if (!target || !bnGte(instance.resources[ResourceId.SHELLS], target.cost)) return null;
    } else {
        target = all
            .filter((c) => bnGte(instance.resources[ResourceId.SHELLS], c.cost))
            .sort((a, b) => a.cost.comparedTo(b.cost))[0];
        if (!target) return null;
    }

    return instance.buyUpgrade(target.id, 1) ? target.id : null;
}

// ─── Simulation ──────────────────────────────────────────────────────────────

type DaySample = {
    day: number;
    shells: BigNum;
    income: BigNum;
    levels: Record<UpgradeId, number>;
    purchases: number;
};

const MILESTONES = [3, 6, 9, 12, 15, 18, 21, 24, 30].map((exp) => ({
    exp,
    threshold: bn(10).pow(exp),
}));

function sample(instance: GameInstance, day: number, purchases: number): DaySample {
    return {
        day,
        shells: instance.resources[ResourceId.SHELLS],
        income: instance.income[ResourceId.SHELLS],
        levels: Object.fromEntries(
            ALL_UPGRADE_IDS.map((id) => [id, instance.upgrades[id].level]),
        ) as Record<UpgradeId, number>,
        purchases,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(
    config: SimulationConfig,
): Promise<{ samples: DaySample[]; instance: GameInstance; reached: Map<number, number> }> {
    // Built from JSON rather than newInstance so the starting capital is exact:
    // applyShellsGain would put the ±10 % roll on it.
    const instance = new GameInstance({
        userId: 'sim',
        resources: { [ResourceId.SHELLS]: String(config.startingShells) },
        stats: { maxShells: String(config.startingShells) },
        income: { [ResourceId.SHELLS]: String(DEFAULT_SHELLS_PER_MESSAGE) },
        streak: { value: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
        upgrades: {},
    });

    const every = config.every > 0 ? config.every : Math.max(1, Math.floor(config.days / 25));
    const samples: DaySample[] = [];
    const reached = new Map<number, number>();
    let purchases = 0;

    for (let day = 1; day <= config.days; day += 1) {
        instance.applyShellsGain(config.messagesPerDay);

        while (tryBuy(instance, config.strategy) !== null) purchases += 1;

        for (const { exp, threshold } of MILESTONES) {
            if (!reached.has(exp) && bnGte(instance.income[ResourceId.SHELLS], threshold)) {
                reached.set(exp, day);
            }
        }

        if (day === 1 || day === config.days || day % every === 0) {
            samples.push(sample(instance, day, purchases));
        }

        if (config.delayMs > 0) {
            printLive(instance, day, purchases, config);
            await sleep(config.delayMs);
        }
    }

    return { samples, instance, reached };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function table(headers: string[], rows: string[][]): string {
    const widths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
    );
    const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ');
    return [line(headers), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map(line)].join(
        '\n',
    );
}

function upgradeColumns(): string[] {
    return ALL_UPGRADE_IDS.map((id) => UPGRADE_REGISTRY[id].emoji);
}

function printProgression(samples: DaySample[]): void {
    const rows = samples.map((s) => [
        String(s.day),
        formatBigNum(s.shells),
        formatBigNum(s.income),
        ...ALL_UPGRADE_IDS.map((id) => String(s.levels[id])),
        String(s.purchases),
    ]);

    console.log(table(['Day', 'Shells', '🐚/msg', ...upgradeColumns(), 'Bought'], rows));
}

function printUpgrades(instance: GameInstance): void {
    const income = instance.income[ResourceId.SHELLS];

    const rows = ALL_UPGRADE_IDS.map((id) => {
        const upgrade = instance.upgrades[id];
        const cost = bnCeil(upgrade.getCost());
        const delta = bnSub(projectedIncome(instance, id), income);
        return [
            `${upgrade.emoji} ${upgrade.name}`,
            String(upgrade.level),
            upgrade.formatGain(),
            `${formatBigNum(cost)} 🐚`,
            delta.lte(0) ? '-' : `+${formatBigNum(delta)} 🐚/msg`,
            delta.lte(0) ? '∞' : formatBigNum(bnDiv(cost, delta)),
        ];
    });

    console.log(
        table(['Upgrade', 'Lvl', 'Effect', 'Next level', 'Next gain', 'Payback (msg)'], rows),
    );
}

function printLive(
    instance: GameInstance,
    day: number,
    purchases: number,
    config: SimulationConfig,
): void {
    process.stdout.write('\x1Bc');
    console.log(`Day ${day} / ${config.days}   ${((day / config.days) * 100).toFixed(1)}%`);
    console.log(`Shells        ${formatBigNum(instance.resources[ResourceId.SHELLS])} 🐚`);
    console.log(`Income        ${formatBigNum(instance.income[ResourceId.SHELLS])} 🐚/msg`);
    console.log(`Levels bought ${purchases}`);
    console.log('');
    printUpgrades(instance);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const config = parseArgs(process.argv.slice(2));
    const { samples, instance, reached } = await run(config);

    if (config.delayMs > 0) process.stdout.write('\x1Bc');

    console.log('══ Idle progression ══');
    console.log(
        `${config.days} days · ${config.messagesPerDay} effective msg/day · strategy ${config.strategy}` +
            (config.startingShells > 0
                ? ` · start ${formatBigNum(bn(config.startingShells))} 🐚`
                : ''),
    );
    console.log('Heat, streak, passive income and jackpot are folded into msg/day.\n');

    printProgression(samples);

    console.log('\n══ Final state ══');
    printUpgrades(instance);

    const earned = bnMul(config.messagesPerDay, config.days);
    console.log(
        `\nBalance ${formatBigNum(instance.resources[ResourceId.SHELLS])} 🐚 · income ${formatBigNum(instance.income[ResourceId.SHELLS])} 🐚/msg`,
    );
    console.log(
        `Income multiplied by ${formatBigNum(bnDiv(instance.income[ResourceId.SHELLS], DEFAULT_SHELLS_PER_MESSAGE))} over ${formatBigNum(earned)} messages`,
    );

    if (reached.size > 0) {
        console.log('\n══ Income milestones ══');
        console.log(
            table(
                ['Income', 'Day', 'Week'],
                [...reached.entries()].map(([exp, day]) => [
                    `1e${exp} 🐚/msg`,
                    String(day),
                    String(Math.ceil(day / 7)),
                ]),
            ),
        );
    }
}

void main();
