#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readStdin() {
    try {
        return readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

function run(command, args) {
    return execFileSync(command, args, {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    });
}

const raw = readStdin();
let input;
try {
    input = JSON.parse(raw);
} catch {
    process.exit(0);
}

const filePath = input?.tool_input?.file_path;
if (typeof filePath !== 'string' || !filePath.endsWith('.ts')) {
    process.exit(0);
}

try {
    run('npx', ['eslint', '--fix', filePath]);
    run('npx', ['prettier', '--write', filePath]);
} catch (error) {
    const output = [error.stdout, error.stderr]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join('\n');
    console.error(output || error.message);
    process.exit(2);
}

process.exit(0);
