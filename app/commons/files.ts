import { readFile, writeFile } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { z } from 'zod';
import type { GuildConfig, ReminderObject, ShellsUser, UserUpgrades } from './types.js';
import { GuildConfigSchema, ReminderObjectSchema, ShellsUserSchema, UserUpgradesSchema } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getFilesDirectory(): string {
    const filesDir = process.env.FILES_DIR || 'files';
    return resolve(__dirname, '../..', filesDir);
}

export const AllowedFiles = {
    CONTEXT: 'context',
    SYSTEM: 'system',
    MEMORY: 'memory',
    REMINDER: 'reminder',
    SHELLS: 'shells',
    UPGRADES: 'upgrades',
    CONFIG: 'config',
} as const;

export type AllowedFile = (typeof AllowedFiles)[keyof typeof AllowedFiles];

/** File types whose on-disk representation is plain text (.txt) */
export type TextFile =
    | typeof AllowedFiles.CONTEXT
    | typeof AllowedFiles.SYSTEM
    | typeof AllowedFiles.MEMORY;

/** Maps each JSON file type to its TypeScript content type */
type JsonFileTypeMap = {
    [AllowedFiles.REMINDER]: ReminderObject[];
    [AllowedFiles.SHELLS]: ShellsUser[];
    [AllowedFiles.UPGRADES]: UserUpgrades[];
    [AllowedFiles.CONFIG]: GuildConfig;
};

/** File types whose on-disk representation is structured JSON (.json) */
export type JsonFile = keyof JsonFileTypeMap;

const TEXT_FILES = new Set<AllowedFile>([
    AllowedFiles.CONTEXT,
    AllowedFiles.SYSTEM,
    AllowedFiles.MEMORY,
]);

/** Default values returned when a JSON file does not yet exist */
const JSON_DEFAULTS: JsonFileTypeMap = {
    [AllowedFiles.REMINDER]: [],
    [AllowedFiles.SHELLS]: [],
    [AllowedFiles.UPGRADES]: [],
    [AllowedFiles.CONFIG]: {},
};

export function isTextFile(fileType: AllowedFile): fileType is TextFile {
    return TEXT_FILES.has(fileType);
}

export function getFilePath(guildId: string, fileType: AllowedFile): string {
    if (!Object.values(AllowedFiles).includes(fileType)) {
        throw new Error(`Invalid file type: ${fileType}`);
    }
    if (!guildId || typeof guildId !== 'string') {
        throw new Error('guildId is required to resolve file path');
    }
    const extension = TEXT_FILES.has(fileType) ? 'txt' : 'json';
    const fileName = `${guildId}-${fileType}.${extension}`;
    return resolve(getFilesDirectory(), fileName);
}

// ─── Text file operations ────────────────────────────────────────────────────

export async function readTextFile(
    guildId: string,
    fileType: TextFile,
): Promise<string> {
    const absolutePath = getFilePath(guildId, fileType);
    return readFile(absolutePath, 'utf-8');
}

export async function writeTextFile(
    guildId: string,
    fileType: TextFile,
    content: string,
): Promise<void> {
    const absolutePath = getFilePath(guildId, fileType);
    await writeFile(absolutePath, content, 'utf-8');
}

// ─── JSON file operations (async) ────────────────────────────────────────────

export async function readJsonFile<K extends JsonFile>(
    guildId: string,
    fileType: K,
): Promise<JsonFileTypeMap[K]> {
    const absolutePath = getFilePath(guildId, fileType);
    try {
        const content = await readFile(absolutePath, 'utf-8');
        return JSON.parse(content) as JsonFileTypeMap[K];
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
            return JSON_DEFAULTS[fileType] as JsonFileTypeMap[K];
        }
        throw error;
    }
}

export async function writeJsonFile<K extends JsonFile>(
    guildId: string,
    fileType: K,
    data: JsonFileTypeMap[K],
): Promise<void> {
    const absolutePath = getFilePath(guildId, fileType);
    await writeFile(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── JSON file operations (sync) ─────────────────────────────────────────────

export function readJsonFileSync<K extends JsonFile>(
    guildId: string,
    fileType: K,
): JsonFileTypeMap[K] {
    const absolutePath = getFilePath(guildId, fileType);
    try {
        const content = readFileSync(absolutePath, 'utf-8');
        return JSON.parse(content) as JsonFileTypeMap[K];
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
            return JSON_DEFAULTS[fileType] as JsonFileTypeMap[K];
        }
        throw error;
    }
}

export function writeJsonFileSync<K extends JsonFile>(
    guildId: string,
    fileType: K,
    data: JsonFileTypeMap[K],
): void {
    const absolutePath = getFilePath(guildId, fileType);
    writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── JSON validation ──────────────────────────────────────────────────────────

const JSON_SCHEMAS = {
    [AllowedFiles.REMINDER]: z.array(ReminderObjectSchema),
    [AllowedFiles.SHELLS]: z.array(ShellsUserSchema),
    [AllowedFiles.UPGRADES]: z.array(UserUpgradesSchema),
    [AllowedFiles.CONFIG]: GuildConfigSchema,
} satisfies Record<JsonFile, z.ZodTypeAny>;

/**
 * Returns a human-readable error string if validation fails, null otherwise.
 */
export function validateJsonFile(fileType: JsonFile, data: unknown): string | null {
    const result = JSON_SCHEMAS[fileType].safeParse(data);
    if (!result.success) {
        return result.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join(', ');
    }
    return null;
}

