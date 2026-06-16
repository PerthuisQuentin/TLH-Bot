/**
 * Upgrade analysis script
 *
 * Run with:
 *   tsx scripts/analyze-upgrade.ts <upgrade> <minLevel> <maxLevel>
 *
 * Examples:
 *   tsx scripts/analyze-upgrade.ts divingOtters 1 40
 *   tsx scripts/analyze-upgrade.ts "Nageoires hydrodynamiques" 1 20 --base-spm=10
 */

import { ALL_UPGRADES } from '../app/idle/upgrades-list.js';
import { getUpgradeCost, getUpgradeGain } from '../app/idle/upgrades.js';
import { UpgradeKind, type UpgradeDefinition } from '../app/idle/types.js';
import { DEFAULT_SHELLS_PER_MESSAGE } from '../app/idle/shells-storage.js';
import { bn, bnSub, bnMul, bnDiv, bnCeil, formatBigNum, type BigNum } from '../app/commons/big-number.js';

type Args = {
    upgradeInput: string;
    minLevel: number;
    maxLevel: number;
    baseSpm: number;
};

function parseArgs(argv: string[]): Args | null {
    if (argv.length < 3) return null;

    const [upgradeInput, minRaw, maxRaw, ...rest] = argv;
    const minLevel = Number(minRaw);
    const maxLevel = Number(maxRaw);

    let baseSpm = DEFAULT_SHELLS_PER_MESSAGE;
    for (const token of rest) {
        if (token.startsWith('--base-spm=')) {
            const parsed = Number(token.slice('--base-spm='.length));
            if (Number.isFinite(parsed) && parsed > 0) baseSpm = parsed;
        }
    }

    if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel)) return null;
    if (minLevel < 1 || maxLevel < minLevel) return null;

    return { upgradeInput, minLevel, maxLevel, baseSpm };
}

function findUpgrade(input: string): UpgradeDefinition | null {
    const norm = input.trim().toLowerCase();
    const exactId = ALL_UPGRADES.find((u) => u.id.toLowerCase() === norm);
    if (exactId) return exactId;

    const exactName = ALL_UPGRADES.find((u) => u.name.toLowerCase() === norm);
    if (exactName) return exactName;

    const partial = ALL_UPGRADES.find(
        (u) => u.id.toLowerCase().includes(norm) || u.name.toLowerCase().includes(norm),
    );
    return partial ?? null;
}

function formatTable(headers: string[], rows: string[][]): string[] {
    const widths = headers.map((header, colIndex) => {
        const maxRowWidth = rows.reduce(
            (max, row) => Math.max(max, row[colIndex]?.length ?? 0),
            0,
        );
        return Math.max(header.length, maxRowWidth);
    });

    const fmtRow = (row: string[]): string => row.map((cell, i) => cell.padEnd(widths[i])).join(' | ');
    return [
        fmtRow(headers),
        widths.map((w) => '-'.repeat(w)).join('-|-'),
        ...rows.map(fmtRow),
    ];
}

function gainAndPaybackForLevel(upgrade: UpgradeDefinition, level: number, baseSpm: number): {
    cost: BigNum;
    gainDisplay: string;
    paybackMessages: BigNum | null;
} {
    const previousLevel = level - 1;
    const cost = bnCeil(getUpgradeCost(upgrade, previousLevel));

    if (upgrade.kind === UpgradeKind.ADDITIVE) {
        const current = getUpgradeGain(upgrade, level);
        const previous = getUpgradeGain(upgrade, previousLevel);
        const marginalSpm = bnSub(current, previous);
        const paybackMessages = marginalSpm.lte(0) ? null : bnDiv(cost, marginalSpm);

        return {
            cost,
            gainDisplay: `+${marginalSpm.toFixed(2)} 🐚/msg`,
            paybackMessages,
        };
    }

    const currentMultiplier = getUpgradeGain(upgrade, level);
    const previousMultiplier = getUpgradeGain(upgrade, previousLevel);
    const deltaSpm = bnSub(bnMul(baseSpm, currentMultiplier), bnMul(baseSpm, previousMultiplier));
    const paybackMessages = deltaSpm.lte(0) ? null : bnDiv(cost, deltaSpm);

    return {
        cost,
        gainDisplay: `+${deltaSpm.toFixed(2)} 🐚/msg`,
        paybackMessages,
    };
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
        console.log('Usage: tsx scripts/analyze-upgrade.ts <upgrade> <minLevel> <maxLevel> [--base-spm=10]');
        process.exitCode = 1;
        return;
    }

    const upgrade = findUpgrade(args.upgradeInput);
    if (!upgrade) {
        console.log(`Upgrade introuvable: ${args.upgradeInput}`);
        console.log(`Disponibles: ${ALL_UPGRADES.map((u) => `${u.id} (${u.name})`).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    const headers = ['Niveau', 'Gain total', 'Cout niveau', 'Gain niveau', 'Payback (msg)'];
    const rows: string[][] = [];

    for (let level = args.minLevel; level <= args.maxLevel; level += 1) {
        const { cost, gainDisplay, paybackMessages } = gainAndPaybackForLevel(upgrade, level, args.baseSpm);
        const totalGain = getUpgradeGain(upgrade, level);
        const totalGainDisplay = upgrade.kind === UpgradeKind.ADDITIVE
            ? `${formatBigNum(totalGain)} 🐚/msg`
            : `×${formatBigNum(totalGain)}`;
        rows.push([
            String(level),
            totalGainDisplay,
            `${formatBigNum(cost)} 🐚`,
            gainDisplay,
            paybackMessages ? formatBigNum(paybackMessages) : '∞',
        ]);
    }

    console.log(`Upgrade: ${upgrade.name} (${upgrade.id})`);
    console.log(`Range: niveaux ${args.minLevel} -> ${args.maxLevel}`);
    if (upgrade.kind === UpgradeKind.MULTIPLICATIVE) {
        console.log(`Base pour payback multiplicatif: ${bn(args.baseSpm).toFixed(2)} 🐚/msg`);
    }
    console.log('');

    for (const line of formatTable(headers, rows)) {
        console.log(line);
    }
}

main();