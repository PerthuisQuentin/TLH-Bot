/**
 * Migration script: adds `stats.totalCoral` to each player of every
 * {guildId}-game-instances.json. The field is every coral the player ever earned, which the
 * ocean scene of `/shells` grows its reef on, and the code now requires it.
 *
 * Backfilled exactly: coral is only ever earned by prestiging and only ever spent on
 * upgrades that no prestige resets, so what was earned is the balance plus the cost of every
 * coral-priced level still owned.
 *
 * Run with:
 *   tsx scripts/add-total-coral.ts                      # dry run over files/
 *   tsx scripts/add-total-coral.ts --apply
 *   tsx scripts/add-total-coral.ts --guild=<id> --apply
 *   tsx scripts/add-total-coral.ts --dir=/path/to/files --apply
 *
 * Must run with the bot stopped, before the new code starts: the new code rejects a file
 * without the field, and the old one would write its copy back without it.
 *
 * Idempotent: an entry that already has the field keeps its value, so a second run writes
 * nothing. Dry run by default.
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
import { bn, bnAdd, type BigNum } from '../app/idle/core/big-number.ts';
import { GameInstanceJsonSchema } from '../app/idle/core/game-instance.ts';
import { ResourceId, UpgradeId } from '../app/idle/core/types.ts';
import { UPGRADE_REGISTRY } from '../app/idle/core/upgrades/upgrade-registry.ts';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const apply = args.includes('--apply');
const filesDir = resolve(flag('dir') ?? process.env.FILES_DIR ?? 'files');
const onlyGuild = flag('guild');

if (!existsSync(filesDir)) {
    console.error(`Files directory not found: ${filesDir}`);
    process.exit(1);
}

// ─── Backfill ────────────────────────────────────────────────────────────────

const CORAL_PRICED = Object.values(UpgradeId).filter(
    (id) => UPGRADE_REGISTRY[id].costResourceId === ResourceId.CORAL,
);

// The formula below rests on this; a coral upgrade that resets would have its spent coral
// forgotten, and the backfill would come out short.
const resetting = CORAL_PRICED.filter((id) => UPGRADE_REGISTRY[id].resetOnPrestige);
if (resetting.length > 0) {
    console.error(`Coral-priced upgrades reset on prestige: ${resetting.join(', ')}. Aborting.`);
    process.exit(1);
}

type StoredEntry = Record<string, unknown> & {
    userId?: string;
    resources?: Partial<Record<ResourceId, string>>;
    stats?: Record<string, unknown>;
    upgrades?: Partial<Record<UpgradeId, number>>;
};

/**
 * Level by level, where the game charged `bnCeil` of each purchase's sum. The two agree
 * while every level costs a whole number, which `fractional` reports when it does not.
 */
function coralEarned(entry: StoredEntry): { total: BigNum; fractional: boolean } {
    let total = bn(entry.resources?.[ResourceId.CORAL] ?? 0);
    let fractional = false;
    for (const id of CORAL_PRICED) {
        const upgrade = new UPGRADE_REGISTRY[id](0);
        for (let level = 0; level < (entry.upgrades?.[id] ?? 0); level++) {
            const cost = upgrade.computeCost(level);
            if (!cost.isInteger()) fractional = true;
            total = bnAdd(total, cost);
        }
    }
    return { total, fractional };
}

// ─── Conversion ──────────────────────────────────────────────────────────────

type GuildReport = {
    guildId: string;
    entries: StoredEntry[];
    added: { userId: string; totalCoral: string; prestigeCount: number }[];
    warnings: string[];
    validationError: string | null;
};

function migrateGuild(guildId: string): GuildReport {
    const path = join(filesDir, `${guildId}-game-instances.json`);
    const entries = JSON.parse(readFileSync(path, 'utf-8')) as StoredEntry[];
    const report: GuildReport = {
        guildId,
        entries,
        added: [],
        warnings: [],
        validationError: null,
    };

    for (const entry of entries) {
        if (!entry.stats || 'totalCoral' in entry.stats) continue;
        const { total, fractional } = coralEarned(entry);
        const prestigeCount = Number(entry.stats.prestigeCount ?? 0);
        const userId = entry.userId ?? '(no userId)';
        if (fractional) report.warnings.push(`${userId}: a coral level has a fractional cost`);
        // Coral comes from prestiges alone, so these two can only disagree on a file edited by hand.
        if ((prestigeCount === 0) !== total.isZero()) {
            report.warnings.push(
                `${userId}: ${prestigeCount} prestige(s) but ${total.toString()} coral`,
            );
        }
        entry.stats.totalCoral = total.toString();
        report.added.push({ userId, totalCoral: total.toString(), prestigeCount });
    }

    // Strict, so the file comes out in exactly the format the code writes, not merely one
    // it tolerates.
    const parsed = z.array(GameInstanceJsonSchema.strict()).safeParse(entries);
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
          .filter((name) => name.endsWith('-game-instances.json'))
          .map((name) => name.replace('-game-instances.json', ''))
          .sort();

if (guildIds.length === 0) {
    console.log(`No game-instances.json found in ${filesDir}. Nothing to migrate.`);
    process.exit(0);
}

console.log(`Directory: ${filesDir}`);
console.log(`Mode:      ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
console.log(`Guilds:    ${guildIds.length}\n`);

let failures = 0;
let written = 0;

for (const guildId of guildIds) {
    const report = migrateGuild(guildId);

    if (report.validationError) {
        console.error(`- ${guildId}: INVALID — ${report.validationError}`);
        failures += 1;
        continue;
    }

    console.log(
        `- ${guildId}: ${report.entries.length} players, ${report.added.length} backfilled, ${report.entries.length - report.added.length} already set`,
    );
    for (const { userId, totalCoral, prestigeCount } of report.added) {
        if (totalCoral !== '0') {
            console.log(`    ${userId}: totalCoral ${totalCoral} (${prestigeCount} prestige(s))`);
        }
    }
    for (const warning of report.warnings) console.warn(`    WARNING ${warning}`);

    if (apply && report.added.length > 0) {
        writeAtomically(
            join(filesDir, `${guildId}-game-instances.json`),
            JSON.stringify(report.entries, null, 2),
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
