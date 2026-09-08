import { readFile, rename, writeFile, unlink } from 'fs/promises';

export type StoredFileTimings = {
    /** Max age of a clean in-RAM copy before it is re-read, for out-of-band edits. */
    staleAfterMs: number;
    /** Delay between the first pending change and the disk write. */
    flushDelayMs: number;
};

/**
 * One file held in RAM. The in-RAM copy is authoritative while dirty: reads are
 * served from it, mutations apply synchronously, and the disk write is deferred.
 *
 * That synchronous mutation is the point. A read-modify-write cycle never spans
 * an await, so two concurrent callers cannot each write back a stale snapshot.
 */
export abstract class StoredFile<T> {
    private value: T | undefined;
    private dirty = false;
    private loadedAt = 0;
    private lastAccessAt = 0;

    /** Deduplicates concurrent misses, which would otherwise each hit the disk. */
    private loading: Promise<T> | null = null;
    /** Chains writes so two flushes never overlap on the same path. */
    private writing: Promise<void> = Promise.resolve();
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(
        readonly path: string,
        private readonly timings: StoredFileTimings,
    ) {}

    protected abstract serialize(value: T): string;
    protected abstract deserialize(raw: string): T;
    /** Value to use when the file does not exist. Rethrow to make it an error. */
    protected abstract onMissing(error: NodeJS.ErrnoException): T;

    get isDirty(): boolean {
        return this.dirty;
    }

    get isLoaded(): boolean {
        return this.value !== undefined;
    }

    /**
     * Returns the live in-RAM value. Callers must treat it as read-only; any
     * mutation has to go through `update` so the change is actually persisted.
     */
    async read(): Promise<T> {
        this.lastAccessAt = Date.now();

        if (this.value !== undefined && !this.isStale()) return this.value;
        if (this.value !== undefined && this.dirty) return this.value;

        return this.load();
    }

    /** Applies `mutate` to the in-RAM value and schedules a write. */
    async update<R>(mutate: (value: T) => R): Promise<R> {
        const value = await this.read();
        const result = mutate(value);
        this.markDirty();
        return result;
    }

    /** Replaces the whole content. Awaits the disk write, unlike `update`. */
    async replace(value: T): Promise<void> {
        this.value = value;
        this.lastAccessAt = Date.now();
        this.markDirty();
        await this.flush();
    }

    /** Writes pending changes to disk. No-op when clean. */
    async flush(): Promise<void> {
        this.clearTimer();
        if (!this.dirty || this.value === undefined) return this.writing;

        const payload = this.serialize(this.value);
        this.dirty = false;

        this.writing = this.writing
            .catch(() => {})
            .then(async () => {
                await this.writeAtomically(payload);
                this.loadedAt = Date.now();
            })
            .catch((error) => {
                // Keep the change pending so a later flush retries it.
                this.dirty = true;
                throw error;
            });

        return this.writing;
    }

    /** True when nothing references this file any more and it can leave RAM. */
    isEvictable(idleAfterMs: number, now: number): boolean {
        return !this.dirty && this.value !== undefined && now - this.lastAccessAt > idleAfterMs;
    }

    private isStale(): boolean {
        return Date.now() - this.loadedAt > this.timings.staleAfterMs;
    }

    private async load(): Promise<T> {
        if (this.loading) return this.loading;

        this.loading = (async () => {
            try {
                const raw = await readFile(this.path, 'utf-8');
                return this.deserialize(raw);
            } catch (error) {
                const err = error as NodeJS.ErrnoException;
                if (err.code === 'ENOENT') return this.onMissing(err);
                throw error;
            }
        })();

        try {
            const loaded = await this.loading;
            // A concurrent update may have dirtied the RAM copy while we were reading;
            // that copy is newer than the disk, so it wins.
            if (!this.dirty) {
                this.value = loaded;
                this.loadedAt = Date.now();
            }
            return this.value ?? loaded;
        } finally {
            this.loading = null;
        }
    }

    private markDirty(): void {
        this.dirty = true;
        if (this.flushTimer) return;
        // Fixed delay from the first pending change rather than a resetting debounce,
        // so a steady stream of updates cannot postpone the write indefinitely.
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush().catch((error) => {
                console.error(`[Storage] Flush failed | path=${this.path}`, error);
            });
        }, this.timings.flushDelayMs);
        this.flushTimer.unref();
    }

    private clearTimer(): void {
        if (!this.flushTimer) return;
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    /** Write to a sibling then rename, so a reader never observes a partial file. */
    private async writeAtomically(payload: string): Promise<void> {
        const tempPath = `${this.path}.${process.pid}.tmp`;
        try {
            await writeFile(tempPath, payload, 'utf-8');
            await rename(tempPath, this.path);
        } catch (error) {
            await unlink(tempPath).catch(() => {});
            throw error;
        }
    }
}

export class JsonStoredFile<T> extends StoredFile<T> {
    constructor(
        path: string,
        timings: StoredFileTimings,
        private readonly fallback: () => T,
    ) {
        super(path, timings);
    }

    protected serialize(value: T): string {
        return JSON.stringify(value, null, 2);
    }

    protected deserialize(raw: string): T {
        return JSON.parse(raw) as T;
    }

    protected onMissing(): T {
        return this.fallback();
    }
}

export class TextStoredFile extends StoredFile<string> {
    protected serialize(value: string): string {
        return value;
    }

    protected deserialize(raw: string): string {
        return raw;
    }

    /** Text files have no default: callers rely on ENOENT to apply their own fallback. */
    protected onMissing(error: NodeJS.ErrnoException): string {
        throw error;
    }
}
