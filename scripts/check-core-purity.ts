/**
 * Core purity check
 * Run with: npm run check:core   (builds first, then reads dist/)
 *
 * app/idle/core/ may depend on nothing outside itself but a short list of packages.
 * ESLint already forbids relative imports that leave core/; this checks the emitted
 * JavaScript, which is the only place a value import hiding behind a type (an enum)
 * shows up as a real runtime dependency.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CORE_DIR = 'dist/app/idle/core';
const ALLOWED_PACKAGES = new Set(['decimal.js', 'zod']);

// Both quote styles: tsc rewrites relative specifiers with double quotes but leaves
// package ones as written, so matching only one would silently pass.
const SPECIFIER = /(?:from|import)\s*['"]([^'"]+)['"]/g;

async function listJsFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return listJsFiles(path);
            return Promise.resolve(entry.name.endsWith('.js') ? [path] : []);
        }),
    );
    return nested.flat();
}

const files = await listJsFiles(CORE_DIR).catch(() => {
    console.error(`${CORE_DIR} not found: run npm run build first.`);
    process.exit(1);
});

const violations: string[] = [];
for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
        if (!specifier.startsWith('.') && !ALLOWED_PACKAGES.has(specifier)) {
            violations.push(`${file}: ${specifier}`);
        }
    }
}

if (violations.length > 0) {
    console.error(
        `core/ imports outside the allowed packages (${[...ALLOWED_PACKAGES].join(', ')}):`,
    );
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}

console.log(
    `core/ is pure: ${files.length} files, packages limited to ${[...ALLOWED_PACKAGES].join(', ')}.`,
);
