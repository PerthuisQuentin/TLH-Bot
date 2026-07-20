#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function run(command, args) {
    return execFileSync(command, args, {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    });
}

const checks = [
    ['tsc', 'npx', ['tsc', '--noEmit']],
    ['lint', 'npm', ['run', 'lint']],
    ['format:check', 'npm', ['run', 'format:check']],
    ['test', 'npm', ['test']],
];

const failures = [];
for (const [name, command, args] of checks) {
    try {
        run(command, args);
    } catch (error) {
        const output = [error.stdout, error.stderr]
            .filter((part) => typeof part === 'string' && part.length > 0)
            .join('\n');
        failures.push(`--- ${name} failed ---\n${output || error.message}`);
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n\n'));
    process.exit(2);
}

process.exit(0);
