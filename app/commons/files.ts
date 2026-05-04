import { readFile, writeFile } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

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
    CONFIG: 'config',
} as const;

export type AllowedFile = (typeof AllowedFiles)[keyof typeof AllowedFiles];

export function getFilePath(
    guildId: string,
    fileType: AllowedFile,
    extension = 'txt',
): string {
    if (!Object.values(AllowedFiles).includes(fileType)) {
        throw new Error(`Invalid file type: ${fileType}`);
    }
    if (!guildId || typeof guildId !== 'string') {
        throw new Error('guildId is required to resolve file path');
    }
    const fileName = `${guildId}-${fileType}.${extension}`;
    return resolve(getFilesDirectory(), fileName);
}

function getExtensionForFileType(fileType: AllowedFile): string {
    const jsonFileTypes: AllowedFile[] = [
        AllowedFiles.REMINDER,
        AllowedFiles.SHELLS,
        AllowedFiles.CONFIG,
    ];
    return jsonFileTypes.includes(fileType) ? 'json' : 'txt';
}

export async function writeFileContent(
    guildId: string,
    fileType: AllowedFile,
    content: string,
): Promise<void> {
    const extension = getExtensionForFileType(fileType);
    const absolutePath = getFilePath(guildId, fileType, extension);
    await writeFile(absolutePath, content, 'utf-8');
}

export async function readFileContent(
    guildId: string,
    fileType: AllowedFile,
): Promise<string> {
    const extension = getExtensionForFileType(fileType);
    const absolutePath = getFilePath(guildId, fileType, extension);
    return readFile(absolutePath, 'utf-8');
}

export async function readJsonFile<T = unknown>(
    guildId: string,
    fileType: AllowedFile,
    defaultValue: T = [] as unknown as T,
): Promise<T> {
    const absolutePath = getFilePath(guildId, fileType, 'json');
    try {
        const content = await readFile(absolutePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
            return defaultValue;
        }
        throw error;
    }
}

export async function writeJsonFile<T = unknown>(
    guildId: string,
    fileType: AllowedFile,
    data: T,
): Promise<void> {
    const absolutePath = getFilePath(guildId, fileType, 'json');
    await writeFile(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJsonFileSync<T = unknown>(
    guildId: string,
    fileType: AllowedFile,
    defaultValue: T = [] as unknown as T,
): T {
    const absolutePath = getFilePath(guildId, fileType, 'json');
    try {
        const content = readFileSync(absolutePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
            return defaultValue;
        }
        throw error;
    }
}

export function writeJsonFileSync<T = unknown>(
    guildId: string,
    fileType: AllowedFile,
    data: T,
): void {
    const absolutePath = getFilePath(guildId, fileType, 'json');
    writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}
