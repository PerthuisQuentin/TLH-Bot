/**
 * Migration script: removes each player's `income` field from every
 * {guildId}-game-instances.json. Income is now derived on load from the upgrades and the
 * growth rings, so the stored copy is dead data.
 *
 * Run with:
 *   tsx scripts/strip-stored-income.ts                      # dry run over files/
 *   tsx scripts/strip-stored-income.ts --apply
 *   tsx scripts/strip-stored-income.ts --guild=<id> --apply
 *   tsx scripts/strip-stored-income.ts --dir=/path/to/files --apply
 *
 * Must run with the bot stopped, before the new code starts: the bot holds the file in RAM
 * and would write its own copy back, the field included.
 *
 * Idempotent: an entry without `income` is left as it is, so a second run writes nothing.
 * Dry run by default.
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

type StoredEntry = Record<string, unknown> & { userId?: string; income?: unknown };

type GuildReport = {
    guildId: string;
    entries: StoredEntry[];
    stripped: number;
    validationError: string | null;
};

function migrateGuild(guildId: string): GuildReport {
    const path = join(filesDir, `${guildId}-game-instances.json`);
    const entries = JSON.parse(readFileSync(path, 'utf-8')) as StoredEntry[];
    const report: GuildReport = { guildId, entries, stripped: 0, validationError: null };

    for (const entry of entries) {
        if (!('income' in entry)) continue;
        delete entry.income;
        report.stripped += 1;
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
        `- ${guildId}: ${report.entries.length} players, ${report.stripped} stripped, ${report.entries.length - report.stripped} already clean`,
    );

    if (apply && report.stripped > 0) {
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
