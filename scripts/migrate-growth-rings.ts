/**
 * Migration script: renames each player's `streak: { value, lastDate }` to
 * `growthRings: { days, lastDate }` in every {guildId}-game-instances.json.
 *
 * Run with:
 *   tsx scripts/migrate-growth-rings.ts                      # dry run over files/
 *   tsx scripts/migrate-growth-rings.ts --apply
 *   tsx scripts/migrate-growth-rings.ts --guild=<id> --apply
 *   tsx scripts/migrate-growth-rings.ts --dir=/path/to/files --apply
 *
 * Must run with the bot stopped, before the renamed code starts: the bot holds the file in
 * RAM and would write its own copy back, and the renamed code cannot read `streak` at all.
 *
 * Idempotent: an entry already carrying `growthRings` is left as it is, so a second run
 * writes nothing. Dry run by default.
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
import { GameInstanceJsonSchema } from '../app/idle/core/game-instance.ts';

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

// ─── Conversion ──────────────────────────────────────────────────────────────

type StoredEntry = Record<string, unknown> & {
    userId?: string;
    streak?: { value: number; lastDate: string };
    growthRings?: unknown;
};

type GuildReport = {
    guildId: string;
    entries: StoredEntry[];
    converted: number;
    alreadyClean: number;
    /** Entries that lose a `streak` field, converted or not: what decides a write. */
    changed: number;
    validationError: string | null;
};

function migrateGuild(guildId: string): GuildReport {
    const path = join(filesDir, `${guildId}-game-instances.json`);
    const entries = JSON.parse(readFileSync(path, 'utf-8')) as StoredEntry[];
    const report: GuildReport = {
        guildId,
        entries,
        converted: 0,
        alreadyClean: 0,
        changed: 0,
        validationError: null,
    };

    for (const entry of entries) {
        if ('streak' in entry) report.changed += 1;
        if (entry.growthRings !== undefined) {
            report.alreadyClean += 1;
        } else if (entry.streak) {
            // The series as stored, broken or not: a lower bound of the days actually played.
            entry.growthRings = { days: entry.streak.value, lastDate: entry.streak.lastDate };
            report.converted += 1;
        }
        delete entry.streak;
    }

    // An entry with neither field fails here rather than reaching the bot unreadable.
    const parsed = z.array(GameInstanceJsonSchema).safeParse(entries);
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
        `- ${guildId}: ${report.entries.length} players, ${report.converted} converted, ${report.alreadyClean} already clean`,
    );
    for (const entry of report.entries.slice(0, 2)) {
        console.log(`    ${entry.userId}: ${JSON.stringify(entry.growthRings)}`);
    }

    if (apply && report.changed > 0) {
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
