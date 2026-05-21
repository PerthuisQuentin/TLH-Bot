/**
 * Migration script: converts threshold values in a config.json file from
 * native numbers to BigNum string format (decimal.js serialisation).
 *
 * Run with:
 *   tsx scripts/migrate-config-bignum.ts <path-to-config.json>
 *
 * Example:
 *   tsx scripts/migrate-config-bignum.ts files/593198902094856206-config.json
 *
 * The file is modified in place. A dry-run preview is printed before writing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from 'decimal.js';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const filePath = process.argv[2];

if (!filePath) {
    console.error('Usage: tsx scripts/migrate-config-bignum.ts <path-to-config.json>');
    process.exit(1);
}

const absolutePath = resolve(filePath);

// ─── Types ───────────────────────────────────────────────────────────────────

type LegacyShellsRoleConfig = {
    roleId: string;
    threshold: number | string;
    [key: string]: unknown;
};

type LegacyGuildConfig = {
    shellsRoles?: LegacyShellsRoleConfig[];
    [key: string]: unknown;
};

// ─── Main ────────────────────────────────────────────────────────────────────

let raw: string;
try {
    raw = readFileSync(absolutePath, 'utf-8');
} catch (err) {
    console.error(`Cannot read file: ${absolutePath}\n${err}`);
    process.exit(1);
}

let config: LegacyGuildConfig;
try {
    config = JSON.parse(raw) as LegacyGuildConfig;
} catch (err) {
    console.error(`Invalid JSON in file: ${absolutePath}\n${err}`);
    process.exit(1);
}

if (typeof config !== 'object' || Array.isArray(config)) {
    console.error('Expected a JSON object at the root of the file.');
    process.exit(1);
}

// ─── Migrate ─────────────────────────────────────────────────────────────────

const shellsRoles = config.shellsRoles;

if (!shellsRoles || shellsRoles.length === 0) {
    console.log(`\nFile: ${absolutePath}`);
    console.log('No shellsRoles entries found. Nothing to migrate.');
    process.exit(0);
}

let migratedCount = 0;
let alreadyMigratedCount = 0;

const migratedRoles = shellsRoles.map((role) => {
    const original = role.threshold;

    if (typeof original === 'string') {
        try {
            new Decimal(original);
        } catch {
            console.warn(`  ⚠ roleId=${role.roleId} has an invalid string threshold: ${JSON.stringify(original)}`);
        }
        alreadyMigratedCount++;
        return role;
    }

    if (typeof original !== 'number' || !isFinite(original)) {
        console.warn(`  ⚠ roleId=${role.roleId} has unexpected threshold value: ${JSON.stringify(original)} — keeping as-is`);
        alreadyMigratedCount++;
        return role;
    }

    migratedCount++;
    return { ...role, threshold: new Decimal(original).toString() };
});

const migratedConfig: LegacyGuildConfig = { ...config, shellsRoles: migratedRoles };

// ─── Preview ─────────────────────────────────────────────────────────────────

console.log(`\nFile: ${absolutePath}`);
console.log(`shellsRoles entries total: ${shellsRoles.length}`);
console.log(`Already in BigNum fmt:     ${alreadyMigratedCount}`);
console.log(`To migrate:                ${migratedCount}`);

if (migratedCount === 0) {
    console.log('\nNothing to migrate. File is already up to date.');
    process.exit(0);
}

console.log('\nPreview:');
for (let i = 0; i < shellsRoles.length; i++) {
    const original = shellsRoles[i]!;
    const updated = migratedRoles[i]!;
    if (original.threshold === updated.threshold) continue;
    console.log(`  roleId=${original.roleId}  threshold: ${JSON.stringify(original.threshold)} → ${JSON.stringify(updated.threshold)}`);
}

// ─── Write ───────────────────────────────────────────────────────────────────

writeFileSync(absolutePath, JSON.stringify(migratedConfig, null, 2), 'utf-8');
console.log(`\n✓ Migration complete. ${migratedCount} role(s) updated.`);
