/**
 * Idle progression simulation
 *
 * Run with:
 *   tsx scripts/simulate-idle.ts
 *
 * Optional args:
 *   --steps=600 --delay=1000 --mps=1 --start-shells=0 --strategy=cheapest
 */

import { ALL_UPGRADES } from '../app/idle/upgrades-list.js';
import { getUpgradeCost, getUpgradeGain, formatUpgradeGain, getMaxBuyable, getUpgradeTotalCost } from '../app/idle/upgrades.js';
import { UpgradeKind } from '../app/idle/types.js';
import { DEFAULT_SHELLS_PER_MESSAGE } from '../app/idle/shells-storage.js';
import {
    bn,
    bnAdd,
    bnDiv,
    bnSub,
    bnMul,
    bnCeil,
    bnGte,
    formatBigNum,
    type BigNum,
} from '../app/commons/big-number.js';

type PurchaseStrategy = 'cheapest' | 'best-payback';

type SimulationConfig = {
    steps: number;
    delayMs: number;
    messagesPerSecond: number;
    startingShells: number;
    strategy: PurchaseStrategy;
};

type SimulationState = {
    shells: BigNum;
    shellsPerMessage: BigNum;
    totalMessages: number;
    totalPurchases: number;
    upgrades: Record<string, number>;
};

const DEFAULT_CONFIG: SimulationConfig = {
    steps: 600,
    delayMs: 1000,
    messagesPerSecond: 1,
    startingShells: 0,
    strategy: 'cheapest',
};

function parseArgs(argv: string[]): SimulationConfig {
    const parsed: SimulationConfig = { ...DEFAULT_CONFIG };

    for (const arg of argv) {
        if (arg.startsWith('--steps=')) {
            const value = Number(arg.slice('--steps='.length));
            if (Number.isFinite(value) && value > 0) parsed.steps = Math.floor(value);
        } else if (arg.startsWith('--delay=')) {
            const value = Number(arg.slice('--delay='.length));
            if (Number.isFinite(value) && value >= 0) parsed.delayMs = Math.floor(value);
        } else if (arg.startsWith('--mps=')) {
            const value = Number(arg.slice('--mps='.length));
            if (Number.isFinite(value) && value > 0) parsed.messagesPerSecond = value;
        } else if (arg.startsWith('--start-shells=')) {
            const value = Number(arg.slice('--start-shells='.length));
            if (Number.isFinite(value) && value >= 0) parsed.startingShells = value;
        } else if (arg.startsWith('--strategy=')) {
            const value = arg.slice('--strategy='.length).trim().toLowerCase();
            if (value === 'cheapest' || value === 'best-payback') {
                parsed.strategy = value;
            }
        }
    }

    return parsed;
}

function createInitialState(config: SimulationConfig): SimulationState {
    const upgrades = Object.fromEntries(ALL_UPGRADES.map((upgrade) => [upgrade.id, 0]));
    return {
        shells: bn(config.startingShells),
        shellsPerMessage: bn(DEFAULT_SHELLS_PER_MESSAGE),
        totalMessages: 0,
        totalPurchases: 0,
        upgrades,
    };
}

function computeShellsPerMessage(upgrades: Record<string, number>): BigNum {
    const additive = ALL_UPGRADES
        .filter((upgrade) => upgrade.kind === UpgradeKind.ADDITIVE)
        .reduce(
            (sum, upgrade) => bnAdd(sum, getUpgradeGain(upgrade, upgrades[upgrade.id] ?? 0)),
            bn(DEFAULT_SHELLS_PER_MESSAGE),
        );

    const multiplier = ALL_UPGRADES
        .filter((upgrade) => upgrade.kind === UpgradeKind.MULTIPLICATIVE)
        .reduce(
            (product, upgrade) => bnMul(product, getUpgradeGain(upgrade, upgrades[upgrade.id] ?? 0)),
            bn(1),
        );

    return bnMul(additive, multiplier);
}

type PurchaseCandidate = {
    upgradeId: string;
    level: number;
    cost: BigNum;
    paybackMessages: BigNum | null;
};

function getPurchaseCandidates(state: SimulationState): PurchaseCandidate[] {
    const currentShellsPerMessage = state.shellsPerMessage;

    return ALL_UPGRADES
        .map((upgrade) => {
            const level = state.upgrades[upgrade.id] ?? 0;
            const cost = bnCeil(getUpgradeCost(upgrade, level));

            const nextLevels = {
                ...state.upgrades,
                [upgrade.id]: level + 1,
            };
            const nextShellsPerMessage = computeShellsPerMessage(nextLevels);
            const gainDelta = bnSub(nextShellsPerMessage, currentShellsPerMessage);

            return {
                upgradeId: upgrade.id,
                level,
                cost,
                paybackMessages: gainDelta.lte(0) ? null : bnDiv(cost, gainDelta),
            };
        });
}

function tryBuyUpgrade(state: SimulationState, strategy: PurchaseStrategy): boolean {
    const candidates = getPurchaseCandidates(state);

    let selected: PurchaseCandidate | undefined;

    if (strategy === 'best-payback') {
        // Find the globally best-payback upgrade, regardless of affordability.
        // Only buy it if we can afford it — never settle for a worse one.
        const best = candidates
            .filter((candidate) => candidate.paybackMessages !== null)
            .sort((a, b) => {
                const paybackCmp = a.paybackMessages!.comparedTo(b.paybackMessages!);
                if (paybackCmp !== 0) return paybackCmp;
                return a.cost.comparedTo(b.cost);
            })[0];

        if (!best || !bnGte(state.shells, best.cost)) return false;
        selected = best;
    } else {
        const affordable = candidates.filter((candidate) => bnGte(state.shells, candidate.cost));
        if (affordable.length === 0) return false;
        selected = affordable.sort((a, b) => a.cost.comparedTo(b.cost))[0];
    }

    if (!selected) return false;

    const selectedUpgrade = ALL_UPGRADES.find((upgrade) => upgrade.id === selected.upgradeId);
    if (!selectedUpgrade) return false;

    const maxBuyable = getMaxBuyable(selectedUpgrade, selected.level, state.shells);
    if (maxBuyable <= 0) return false;

    const totalCost = bnCeil(getUpgradeTotalCost(selectedUpgrade, selected.level, maxBuyable));

    state.shells = bnSub(state.shells, totalCost);
    state.upgrades[selected.upgradeId] = selected.level + maxBuyable;
    state.shellsPerMessage = computeShellsPerMessage(state.upgrades);
    state.totalPurchases += maxBuyable;
    return true;
}

function printUpgradeSummary(state: SimulationState): void {
    const currentShellsPerMessage = state.shellsPerMessage;

    console.log('Upgrades:');
    const headers = ['Upgrade', 'Niveau', 'Bonus', 'Cout', 'Prochain gain/msg', 'Pour acheter (msg)', 'Payback (msg)'];
    const rows: string[][] = [];

    for (const upgrade of ALL_UPGRADES) {
        const level = state.upgrades[upgrade.id] ?? 0;
        const gain = formatUpgradeGain(upgrade, level);
        const nextCost = bnCeil(getUpgradeCost(upgrade, level));

        const nextLevels = {
            ...state.upgrades,
            [upgrade.id]: level + 1,
        };
        const nextShellsPerMessage = computeShellsPerMessage(nextLevels);
        const gainDelta = bnSub(nextShellsPerMessage, currentShellsPerMessage);
        const paybackMessages = gainDelta.lte(0) ? null : bnDiv(nextCost, gainDelta);

        const messagesNeeded = bnCeil(bnDiv(nextCost, currentShellsPerMessage));

        rows.push([
            upgrade.name,
            `x${level}`,
            gain,
            `${formatBigNum(nextCost)} 🐚`,
            `${formatBigNum(nextShellsPerMessage)} 🐚/msg`,
            messagesNeeded ? formatBigNum(messagesNeeded) : '∞',
            paybackMessages ? formatBigNum(paybackMessages) : '∞',
        ]);
    }

    const colWidths = headers.map((header, colIndex) => {
        const maxRowWidth = rows.reduce(
            (max, row) => Math.max(max, row[colIndex]?.length ?? 0),
            0,
        );
        return Math.max(header.length, maxRowWidth);
    });

    const formatRow = (row: string[]): string =>
        row
            .map((cell, colIndex) => cell.padEnd(colWidths[colIndex]))
            .join(' | ');

    console.log(formatRow(headers));
    console.log(colWidths.map((w) => '-'.repeat(w)).join('-|-'));
    for (const row of rows) {
        console.log(formatRow(row));
    }
}

function clearConsole(): void {
    process.stdout.write('\x1Bc');
}

function printSnapshot(step: number, state: SimulationState, config: SimulationConfig): void {
    clearConsole();

    const progress = ((step / config.steps) * 100).toFixed(1);

    const strategyLabel = config.strategy === 'best-payback' ? 'meilleur payback' : 'moins chere';
    console.log(`Simulation idle game (achat auto: ${strategyLabel})`);
    console.log(
        `Config: steps=${config.steps} | delay=${config.delayMs}ms | mps=${config.messagesPerSecond} | startShells=${config.startingShells} | strategy=${config.strategy}`,
    );
    console.log(`Progression: ${step} / ${config.steps} (${progress}%)`);
    console.log('');
    console.log(`Shells: ${formatBigNum(state.shells)} 🐚`);
    console.log(`Shells/message: ${formatBigNum(state.shellsPerMessage)} 🐚`);
    console.log(`Messages envoyes: ${state.totalMessages}`);
    console.log(`Achats: ${state.totalPurchases}`);
    printUpgradeSummary(state);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSimulation(config: SimulationConfig): Promise<void> {
    const state = createInitialState(config);
    let messageAccumulator = 0;
    const startedAtMs = Date.now();

    for (let step = 1; step <= config.steps; step += 1) {
        messageAccumulator += config.messagesPerSecond;
        const messagesThisStep = Math.floor(messageAccumulator);
        messageAccumulator -= messagesThisStep;

        for (let i = 0; i < messagesThisStep; i += 1) {
            state.shells = bnAdd(state.shells, state.shellsPerMessage);
            state.totalMessages += 1;

            // Keep buying as long as the selected strategy can afford an upgrade.
            while (tryBuyUpgrade(state, config.strategy)) {
                // Intentionally empty: buying loop handled in condition.
            }
        }

        printSnapshot(step, state, config);

        if (config.delayMs > 0) {
            const nextTickAtMs = startedAtMs + step * config.delayMs;
            const waitMs = nextTickAtMs - Date.now();
            if (waitMs > 0) {
                await sleep(waitMs);
            }
        }
    }

    console.log('');
    console.log('Simulation terminee.');
}

void runSimulation(parseArgs(process.argv.slice(2)));