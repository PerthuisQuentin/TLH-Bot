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

import { ALL_UPGRADE_CLASSES } from '../app/idle/core/upgrades/upgrade-registry.ts';
import type { BaseUpgrade } from '../app/idle/core/upgrades/base-upgrade.ts';
import { ResourceId, UpgradeKind } from '../app/idle/core/types.ts';
import { formatResource } from '../app/idle/core/resources.ts';
import { DEFAULT_SHELLS_PER_MESSAGE } from '../app/idle/core/game-instance.ts';
import {
    bn,
    bnSub,
    bnMul,
    bnDiv,
    bnCeil,
    formatBigNum,
    type BigNum,
} from '../app/idle/core/big-number.ts';

type UpgradeConstructor = new (level: number) => BaseUpgrade;

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

function findUpgrade(input: string): UpgradeConstructor | null {
    const norm = input.trim().toLowerCase();
    return (
        ALL_UPGRADE_CLASSES.find((Cls) => {
            const u = new Cls(0);
            return u.id.toLowerCase() === norm || u.name.toLowerCase() === norm;
        }) ?? null
    );
}

function formatTable(headers: string[], rows: string[][]): string[] {
    const widths = headers.map((header, colIndex) => {
        const maxRowWidth = rows.reduce((max, row) => Math.max(max, row[colIndex]?.length ?? 0), 0);
        return Math.max(header.length, maxRowWidth);
    });

    const fmtRow = (row: string[]): string =>
        row.map((cell, i) => cell.padEnd(widths[i])).join(' | ');
    return [fmtRow(headers), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map(fmtRow)];
}

function gainAndPaybackForLevel(
    Upgrade: UpgradeConstructor,
    level: number,
    baseSpm: number,
): {
    cost: BigNum;
    gainDisplay: string;
    paybackMessages: BigNum | null;
} {
    const previousLevel = level - 1;
    const cost = bnCeil(new Upgrade(previousLevel).getCost());
    const current = new Upgrade(level);
    const previous = new Upgrade(previousLevel);

    // Both halves of the column are per-message figures, so neither means anything for an
    // upgrade that does not pay in shells: the polyps pay coral, once, at a prestige.
    if (current.gainResourceId !== ResourceId.SHELLS) {
        return {
            cost,
            gainDisplay: `${previous.formatGain()} -> ${current.formatGain()}`,
            paybackMessages: null,
        };
    }

    // Amortising a price in messages only means something when the level is paid for in the
    // resource it earns. A coral price against shells per message is a unit mismatch.
    const amortisable = current.costResourceId === current.gainResourceId;

    if (current.kind === UpgradeKind.ADDITIVE) {
        const marginalSpm = bnSub(current.getGain(), previous.getGain());
        const paybackMessages =
            !amortisable || marginalSpm.lte(0) ? null : bnDiv(cost, marginalSpm);
        return { cost, gainDisplay: `+${marginalSpm.toFixed(2)} 🐚/msg`, paybackMessages };
    }

    const deltaSpm = bnSub(bnMul(baseSpm, current.getGain()), bnMul(baseSpm, previous.getGain()));
    const paybackMessages = !amortisable || deltaSpm.lte(0) ? null : bnDiv(cost, deltaSpm);
    return { cost, gainDisplay: `+${deltaSpm.toFixed(2)} 🐚/msg`, paybackMessages };
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
        console.log(
            'Usage: tsx scripts/analyze-upgrade.ts <upgrade> <minLevel> <maxLevel> [--base-spm=10]',
        );
        process.exitCode = 1;
        return;
    }

    const Upgrade = findUpgrade(args.upgradeInput);
    if (!Upgrade) {
        console.log(`Upgrade introuvable: ${args.upgradeInput}`);
        console.log(
            `Disponibles: ${ALL_UPGRADE_CLASSES.map((Cls) => {
                const u = new Cls(0);
                return `${u.id} (${u.name})`;
            }).join(', ')}`,
        );
        process.exitCode = 1;
        return;
    }

    const meta = new Upgrade(0);
    const headers = ['Niveau', 'Gain total', 'Cout niveau', 'Gain niveau', 'Payback (msg)'];
    const rows: string[][] = [];

    for (let level = args.minLevel; level <= args.maxLevel; level += 1) {
        const { cost, gainDisplay, paybackMessages } = gainAndPaybackForLevel(
            Upgrade,
            level,
            args.baseSpm,
        );
        const totalGain = new Upgrade(level).getGain();
        const totalGainDisplay =
            meta.kind === UpgradeKind.ADDITIVE
                ? `${formatBigNum(totalGain)} 🐚/msg`
                : `×${formatBigNum(totalGain)}`;
        rows.push([
            String(level),
            totalGainDisplay,
            formatResource(cost, meta.costResourceId),
            gainDisplay,
            paybackMessages ? formatBigNum(paybackMessages) : '∞',
        ]);
    }

    console.log(`Upgrade: ${meta.name} (${meta.id})`);
    console.log(`Range: niveaux ${args.minLevel} -> ${args.maxLevel}`);
    if (meta.kind === UpgradeKind.MULTIPLICATIVE && meta.gainResourceId === ResourceId.SHELLS) {
        console.log(`Base pour payback multiplicatif: ${bn(args.baseSpm).toFixed(2)} 🐚/msg`);
    }
    console.log('');

    for (const line of formatTable(headers, rows)) {
        console.log(line);
    }
}

main();
