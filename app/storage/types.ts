import { z } from 'zod';
import type { GuildConfig, ShellsUser, UserUpgrades } from '../commons/types.ts';
import { GuildConfigSchema, ShellsUserSchema, UserUpgradesSchema } from '../commons/types.ts';
import type { GameInstanceJson } from '../idle/core/game-instance.ts';
import { GameInstanceJsonSchema } from '../idle/core/game-instance.ts';

export const AllowedFiles = {
    SYSTEM: 'system',
    MEMORY: 'memory',
    SHELLS: 'shells',
    UPGRADES: 'upgrades',
    CONFIG: 'config',
    GAME_INSTANCES: 'game-instances',
} as const;

export type AllowedFile = (typeof AllowedFiles)[keyof typeof AllowedFiles];

/** File types whose on-disk representation is plain text (.txt) */
export type TextFile = typeof AllowedFiles.SYSTEM | typeof AllowedFiles.MEMORY;

/** Maps each JSON file type to its TypeScript content type */
export type JsonFileTypeMap = {
    [AllowedFiles.SHELLS]: ShellsUser[];
    [AllowedFiles.UPGRADES]: UserUpgrades[];
    [AllowedFiles.CONFIG]: GuildConfig;
    [AllowedFiles.GAME_INSTANCES]: GameInstanceJson[];
};

/** File types whose on-disk representation is structured JSON (.json) */
export type JsonFile = keyof JsonFileTypeMap;

const TEXT_FILES = new Set<AllowedFile>([AllowedFiles.SYSTEM, AllowedFiles.MEMORY]);

export function isTextFile(fileType: AllowedFile): fileType is TextFile {
    return TEXT_FILES.has(fileType);
}

/** Returned when a JSON file does not exist yet; a missing file is not an error. */
export const JSON_DEFAULTS: JsonFileTypeMap = {
    [AllowedFiles.SHELLS]: [],
    [AllowedFiles.UPGRADES]: [],
    [AllowedFiles.CONFIG]: {},
    [AllowedFiles.GAME_INSTANCES]: [],
};

/** Guards the REST write route against a payload that would corrupt a file. */
export const JSON_SCHEMAS = {
    [AllowedFiles.SHELLS]: z.array(ShellsUserSchema),
    [AllowedFiles.UPGRADES]: z.array(UserUpgradesSchema),
    [AllowedFiles.CONFIG]: GuildConfigSchema,
    [AllowedFiles.GAME_INSTANCES]: z.array(GameInstanceJsonSchema),
} satisfies Record<JsonFile, z.ZodTypeAny>;

/** Returns a human-readable error string if validation fails, null otherwise. */
export function validateJsonFile(fileType: JsonFile, data: unknown): string | null {
    const result = JSON_SCHEMAS[fileType].safeParse(data);
    if (result.success) return null;
    return result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join(', ');
}
