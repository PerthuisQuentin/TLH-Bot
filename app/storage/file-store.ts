import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
    JsonStoredFile,
    StoredFile,
    TextStoredFile,
    type StoredFileTimings,
} from './stored-file.ts';
import {
    AllowedFiles,
    JSON_DEFAULTS,
    isTextFile,
    type AllowedFile,
    type JsonFile,
    type JsonFileTypeMap,
    type TextFile,
} from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

type FileStoreOptions = StoredFileTimings & {
    /** How long an untouched clean file stays in RAM. */
    idleAfterMs: number;
    /** How often idle files are swept out. */
    sweepIntervalMs: number;
};

export const DEFAULT_OPTIONS: FileStoreOptions = {
    staleAfterMs: 60_000,
    flushDelayMs: 1_000,
    idleAfterMs: 120_000,
    sweepIntervalMs: 30_000,
};

export function getFilesDirectory(): string {
    const filesDir = process.env.FILES_DIR || 'files';
    return resolve(__dirname, '../..', filesDir);
}

/**
 * Guild ids reach this module straight from the REST route params and end up inside
 * a path, so the check is an allowlist rather than a blocklist: a single `.` or `/`
 * would be enough for `resolve` to climb out of `files/`. Covers Discord snowflakes
 * and the `dm` pseudo-guild `/ask` falls back to outside a server.
 */
const GUILD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidGuildId(guildId: unknown): guildId is string {
    return typeof guildId === 'string' && GUILD_ID_PATTERN.test(guildId);
}

export function getFilePath(guildId: string, fileType: AllowedFile): string {
    if (!Object.values(AllowedFiles).includes(fileType)) {
        throw new Error(`Invalid file type: ${fileType}`);
    }
    if (!isValidGuildId(guildId)) {
        throw new Error(`Invalid guildId: ${JSON.stringify(guildId)}`);
    }
    const extension = isTextFile(fileType) ? 'txt' : 'json';
    return resolve(getFilesDirectory(), `${guildId}-${fileType}.${extension}`);
}

/**
 * Owns every file held in RAM, keyed by guild and type.
 *
 * Game updates go through `updateJson` and are written back on a short delay;
 * REST writes go through `writeJson` / `writeText` and reach the disk before
 * returning, because their caller is told the write happened.
 */
export class FileStore {
    private readonly files = new Map<string, StoredFile<unknown>>();
    private sweeper: NodeJS.Timeout | null = null;

    constructor(private readonly options: FileStoreOptions = DEFAULT_OPTIONS) {}

    async readJson<K extends JsonFile>(guildId: string, fileType: K): Promise<JsonFileTypeMap[K]> {
        return this.json(guildId, fileType).read();
    }

    /**
     * Mutates the file in place and schedules the write. `mutate` must stay
     * synchronous: that is what makes the read-modify-write cycle atomic.
     */
    async updateJson<K extends JsonFile, R>(
        guildId: string,
        fileType: K,
        mutate: (value: JsonFileTypeMap[K]) => R,
    ): Promise<R> {
        return this.json(guildId, fileType).update(mutate);
    }

    async writeJson<K extends JsonFile>(
        guildId: string,
        fileType: K,
        value: JsonFileTypeMap[K],
    ): Promise<void> {
        return this.json(guildId, fileType).replace(value);
    }

    async readText(guildId: string, fileType: TextFile): Promise<string> {
        return this.text(guildId, fileType).read();
    }

    async writeText(guildId: string, fileType: TextFile, content: string): Promise<void> {
        return this.text(guildId, fileType).replace(content);
    }

    /** Forces pending changes to disk now, for writes the caller must not lose. */
    async flush(guildId: string, fileType: AllowedFile): Promise<void> {
        const file = this.files.get(getFilePath(guildId, fileType));
        if (file) await file.flush();
    }

    async flushAll(): Promise<void> {
        await Promise.all([...this.files.values()].map((file) => file.flush()));
    }

    /** Starts the idle sweeper and registers the shutdown flush. */
    start(): void {
        if (this.sweeper) return;
        this.sweeper = setInterval(() => void this.sweep(), this.options.sweepIntervalMs);
        this.sweeper.unref();
    }

    stop(): void {
        if (!this.sweeper) return;
        clearInterval(this.sweeper);
        this.sweeper = null;
    }

    private async sweep(): Promise<void> {
        const now = Date.now();
        for (const [path, file] of this.files) {
            if (file.isEvictable(this.options.idleAfterMs, now)) this.files.delete(path);
        }
    }

    private json<K extends JsonFile>(guildId: string, fileType: K): StoredFile<JsonFileTypeMap[K]> {
        return this.resolve(
            guildId,
            fileType,
            (path) =>
                new JsonStoredFile<JsonFileTypeMap[K]>(
                    path,
                    this.options,
                    // Cloned so a caller mutating the value never poisons the shared default.
                    () => structuredClone(JSON_DEFAULTS[fileType]),
                ),
        );
    }

    private text(guildId: string, fileType: TextFile): StoredFile<string> {
        return this.resolve(guildId, fileType, (path) => new TextStoredFile(path, this.options));
    }

    private resolve<T>(
        guildId: string,
        fileType: AllowedFile,
        create: (path: string) => StoredFile<T>,
    ): StoredFile<T> {
        const path = getFilePath(guildId, fileType);
        const existing = this.files.get(path);
        if (existing) return existing as StoredFile<T>;

        const file = create(path);
        this.files.set(path, file);
        return file;
    }
}
