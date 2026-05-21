/**
 * Migration script: converts a shells.json file from native number values
 * to BigNum string format (decimal.js serialisation).
 *
 * Run with:
 *   tsx scripts/migrate-shells-bignum.ts <path-to-shells.json>
 *
 * Example:
 *   tsx scripts/migrate-shells-bignum.ts files/593198902094856206-shells.json
 *
 * The file is modified in place. A dry-run preview is printed before writing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from 'decimal.js';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const filePath = process.argv[2];

if (!filePath) {
    console.error('Usage: tsx scripts/migrate-shells-bignum.ts <path-to-shells.json>');
    process.exit(1);
}

const absolutePath = resolve(filePath);

// ─── Types ───────────────────────────────────────────────────────────────────

type LegacyShellsUser = {
    userId: string;
    shells: number | string;
    maxShells: number | string;
    shellsPerMessage: number | string;
    [key: string]: unknown;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converts a value to its BigNum string if it is still a native number. */
function migrateField(value: number | string, fieldName: string, userId: string): string {
    if (typeof value === 'string') {
        // Already migrated — validate that it parses correctly
        try {
            new Decimal(value);
        } catch {
            console.warn(`  ⚠ userId=${userId} field="${fieldName}" has an invalid string value: ${JSON.stringify(value)}`);
        }
        return value;
    }

    if (typeof value !== 'number' || !isFinite(value)) {
        console.warn(`  ⚠ userId=${userId} field="${fieldName}" has unexpected value: ${JSON.stringify(value)} — keeping as-is`);
        return String(value);
    }

    return new Decimal(value).toString();
}

// ─── Main ────────────────────────────────────────────────────────────────────

let raw: string;
try {
    raw = readFileSync(absolutePath, 'utf-8');
} catch (err) {
    console.error(`Cannot read file: ${absolutePath}\n${err}`);
    process.exit(1);
}

let users: LegacyShellsUser[];
try {
    users = JSON.parse(raw) as LegacyShellsUser[];
} catch (err) {
    console.error(`Invalid JSON in file: ${absolutePath}\n${err}`);
    process.exit(1);
}

if (!Array.isArray(users)) {
    console.error('Expected a JSON array at the root of the file.');
    process.exit(1);
}

// ─── Migrate ─────────────────────────────────────────────────────────────────

const NUMERIC_FIELDS = ['shells', 'maxShells', 'shellsPerMessage'] as const;
let migratedCount = 0;
let alreadyMigratedCount = 0;

const migrated = users.map((user) => {
    const result: LegacyShellsUser = { ...user };
    let userMigrated = false;

    for (const field of NUMERIC_FIELDS) {
        const original = user[field];
        if (original === undefined) {
            console.warn(`  ⚠ userId=${user.userId} missing field "${field}" — skipping`);
            continue;
        }

        const wasNumber = typeof original === 'number';
        result[field] = migrateField(original as number | string, field, user.userId);

        if (wasNumber) userMigrated = true;
    }

    if (userMigrated) {
        migratedCount++;
    } else {
        alreadyMigratedCount++;
    }

    return result;
});

// ─── Preview ─────────────────────────────────────────────────────────────────

console.log(`\nFile: ${absolutePath}`);
console.log(`Users total:           ${users.length}`);
console.log(`Already in BigNum fmt: ${alreadyMigratedCount}`);
console.log(`To migrate:            ${migratedCount}`);

if (migratedCount === 0) {
    console.log('\nNothing to migrate. File is already up to date.');
    process.exit(0);
}

console.log('\nPreview (first 3 migrated users):');
let shown = 0;
for (let i = 0; i < users.length && shown < 3; i++) {
    const original = users[i]!;
    const updated = migrated[i]!;
    const changed = NUMERIC_FIELDS.some((f) => original[f] !== updated[f]);
    if (!changed) continue;
    console.log(`\n  userId: ${original.userId}`);
    for (const field of NUMERIC_FIELDS) {
        if (original[field] !== updated[field]) {
            console.log(`    ${field}: ${JSON.stringify(original[field])} → ${JSON.stringify(updated[field])}`);
        }
    }
    shown++;
}

// ─── Write ───────────────────────────────────────────────────────────────────

writeFileSync(absolutePath, JSON.stringify(migrated, null, 2), 'utf-8');
console.log(`\n✓ Migration complete. ${migratedCount} user(s) updated.`);
