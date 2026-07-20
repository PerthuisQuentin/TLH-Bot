/**
 * Migration script: builds {guildId}-game-instances.json from the pre-refactor
 * {guildId}-shells.json + {guildId}-upgrades.json pair.
 *
 * Run with:
 *   tsx scripts/migrate-game-instances.ts                      # dry run over files/
 *   tsx scripts/migrate-game-instances.ts --apply
 *   tsx scripts/migrate-game-instances.ts --guild=<id> --apply
 *   tsx scripts/migrate-game-instances.ts --dir=/path/to/files --apply
 *   tsx scripts/migrate-game-instances.ts --apply --force       # overwrite existing
 *   tsx scripts/migrate-game-instances.ts --apply --recompute-income
 *
 * Shells income is copied as-is by default, so no player's income changes.
 * The script still recomputes it from the upgrade levels and reports any
 * mismatch; --recompute-income then trusts the levels over the stored value.
 *
 * Dry run by default. An existing game-instances.json is never overwritten
 * without --force: once the bot has run, that file is the live state and the
 * legacy pair is stale.
 *
 * The legacy files are left untouched; the REST API still exposes them.
 */

import {
    existsSync,
    readFileSync,
    readdirSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
    DEFAULT_SHELLS_PER_MESSAGE,
    GameInstance,
    GameInstanceJsonSchema,
    type GameInstanceJson,
} from '../app/idle/core/game-instance.ts';
import { ResourceId, UpgradeId } from '../app/idle/core/types.ts';
import { bn, formatBigNum } from '../app/idle/core/big-number.ts';

// ─── Legacy shapes ───────────────────────────────────────────────────────────

/** Values may still be native numbers on guilds that predate the bignum migration. */
type LegacyShellsUser = {
    userId: string;
    shells?: number | string;
    maxShells?: number | string;
    shellsPerMessage?: number | string;
    streak?: number;
    lastStreakDate?: string;
    lastActiveAt?: string;
};

type LegacyUserUpgrades = {
    userId: string;
    divingOtters?: number;
    hydrodynamicFlippers?: number;
    harvestBags?: number;
};

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const apply = args.includes('--apply');
const force = args.includes('--force');
// Off by default: rewriting a player's income is a gameplay change, not a format change.
const recomputeIncome = args.includes('--recompute-income');
const filesDir = resolve(flag('dir') ?? process.env.FILES_DIR ?? 'files');
const onlyGuild = flag('guild');

if (!existsSync(filesDir)) {
    console.error(`Files directory not found: ${filesDir}`);
    process.exit(1);
}

// ─── Conversion ──────────────────────────────────────────────────────────────

function toBigNumString(value: number | string | undefined, fallback: string): string {
    if (value === undefined || value === null || value === '') return fallback;
    return bn(value).toString();
}

function readJson<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

type GuildReport = {
    guildId: string;
    instances: GameInstanceJson[];
    fromShellsOnly: number;
    fromUpgradesOnly: number;
    incomeMismatches: Array<{ userId: string; stored: string; recomputed: string; levels: string }>;
    skipped: string | null;
    validationError: string | null;
};

function migrateGuild(guildId: string): GuildReport {
    const report: GuildReport = {
        guildId,
        instances: [],
        fromShellsOnly: 0,
        fromUpgradesOnly: 0,
        incomeMismatches: [],
        skipped: null,
        validationError: null,
    };

    const target = join(filesDir, `${guildId}-game-instances.json`);
    if (existsSync(target) && !force) {
        report.skipped = 'game-instances.json already exists (use --force to overwrite)';
        return report;
    }

    const shells = readJson<LegacyShellsUser[]>(join(filesDir, `${guildId}-shells.json`), []);
    const upgrades = readJson<LegacyUserUpgrades[]>(join(filesDir, `${guildId}-upgrades.json`), []);

    const shellsById = new Map(shells.map((u) => [u.userId, u]));
    const upgradesById = new Map(upgrades.map((u) => [u.userId, u]));
    const userIds = [...new Set([...shellsById.keys(), ...upgradesById.keys()])];

    const nowIso = new Date().toISOString();

    for (const userId of userIds) {
        const legacy = shellsById.get(userId);
        const levels = upgradesById.get(userId);

        if (!legacy) report.fromUpgradesOnly += 1;
        if (!levels) report.fromShellsOnly += 1;

        const balance = toBigNumString(legacy?.shells, '0');
        const json: GameInstanceJson = {
            userId,
            resources: { [ResourceId.SHELLS]: balance },
            // maxShells did not always exist; the old readers fell back to shells.
            stats: { maxShells: toBigNumString(legacy?.maxShells ?? legacy?.shells, balance) },
            income: {
                [ResourceId.SHELLS]: toBigNumString(
                    legacy?.shellsPerMessage,
                    String(DEFAULT_SHELLS_PER_MESSAGE),
                ),
            },
            streak: {
                value: legacy?.streak ?? 0,
                // An empty lastDate makes the next update start a fresh streak at 1.
                lastDate: legacy?.lastStreakDate ?? '',
            },
            // Missing lastActiveAt means passive income starts accruing from now,
            // rather than paying out for the whole gap since the account was created.
            lastActiveAt: legacy?.lastActiveAt ?? nowIso,
            upgrades: {
                [UpgradeId.DIVING_OTTERS]: levels?.divingOtters ?? 0,
                [UpgradeId.HYDRODYNAMIC_FLIPPERS]: levels?.hydrodynamicFlippers ?? 0,
                [UpgradeId.HARVEST_BAGS]: levels?.harvestBags ?? 0,
            },
        };

        // Cross-check: the stored income should match what the current formulas
        // produce for those upgrade levels. A mismatch means the pair drifted,
        // or that a curve moved since the value was last written. Legacy data only
        // ever represented one resource, so this stays scoped to shells.
        const storedIncome = json.income[ResourceId.SHELLS] ?? '0';
        const recomputed = new GameInstance(json).computeIncome()[ResourceId.SHELLS];
        if (!recomputed.equals(bn(storedIncome))) {
            report.incomeMismatches.push({
                userId,
                // Full precision on purpose: formatBigNum would round both sides
                // to three significant digits and hide the difference.
                stored: storedIncome,
                recomputed: recomputed.toString(),
                levels: Object.values(json.upgrades).join('/'),
            });
            if (recomputeIncome) json.income[ResourceId.SHELLS] = recomputed.toString();
        }

        report.instances.push(json);
    }

    const parsed = z.array(GameInstanceJsonSchema).safeParse(report.instances);
    if (!parsed.success) {
        report.validationError = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join(', ');
    }

    return report;
}

function writeAtomically(path: string, payload: string): void {
    const tempPath = `${path}.${process.pid}.tmp`;
    try {
        writeFileSync(tempPath, payload, 'utf-8');
        renameSync(tempPath, path);
    } catch (error) {
        if (existsSync(tempPath)) unlinkSync(tempPath);
        throw error;
    }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const guildIds = onlyGuild
    ? [onlyGuild]
    : readdirSync(filesDir)
          .filter((name) => name.endsWith('-shells.json'))
          .map((name) => name.replace('-shells.json', ''))
          .sort();

if (guildIds.length === 0) {
    console.log(`No legacy shells.json found in ${filesDir}. Nothing to migrate.`);
    process.exit(0);
}

console.log(`Directory: ${filesDir}`);
console.log(`Mode:      ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
console.log(`Guilds:    ${guildIds.length}\n`);

let failures = 0;
let written = 0;

for (const guildId of guildIds) {
    const report = migrateGuild(guildId);

    if (report.skipped) {
        console.log(`- ${guildId}: SKIPPED — ${report.skipped}`);
        continue;
    }

    if (report.validationError) {
        console.error(`- ${guildId}: INVALID — ${report.validationError}`);
        failures += 1;
        continue;
    }

    console.log(`- ${guildId}: ${report.instances.length} players`);
    if (report.fromShellsOnly > 0)
        console.log(`    ${report.fromShellsOnly} without an upgrades entry (levels default to 0)`);
    if (report.fromUpgradesOnly > 0)
        console.log(
            `    ${report.fromUpgradesOnly} without a shells entry (balance defaults to 0)`,
        );

    if (report.incomeMismatches.length > 0) {
        console.warn(
            `    ⚠ ${report.incomeMismatches.length} income mismatch(es) — ${recomputeIncome ? 'RECOMPUTED value used' : 'stored value kept, pass --recompute-income to use the computed one'}:`,
        );
        for (const m of report.incomeMismatches.slice(0, 5)) {
            console.warn(
                `      userId=${m.userId} levels=${m.levels} stored=${m.stored} recomputed=${m.recomputed}`,
            );
        }
    }

    for (const instance of report.instances.slice(0, 2)) {
        console.log(
            `    ${instance.userId}: shells=${formatBigNum(bn(instance.resources[ResourceId.SHELLS] ?? '0'))} max=${formatBigNum(bn(instance.stats.maxShells))} spm=${formatBigNum(bn(instance.income[ResourceId.SHELLS] ?? '0'))} streak=${instance.streak.value} upgrades=${Object.values(instance.upgrades).join('/')}`,
        );
    }

    if (apply) {
        writeAtomically(
            join(filesDir, `${guildId}-game-instances.json`),
            JSON.stringify(report.instances, null, 2),
        );
        written += 1;
        console.log(`    written`);
    }
}

console.log(`\n${apply ? `${written} file(s) written.` : 'Dry run — nothing written.'}`);
if (failures > 0) {
    console.error(`${failures} guild(s) failed validation.`);
    process.exit(1);
}
