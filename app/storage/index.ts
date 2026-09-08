import { FileStore } from './file-store.ts';

export {
    FileStore,
    getFilePath,
    getFilesDirectory,
    isValidGuildId,
    DEFAULT_OPTIONS,
} from './file-store.ts';
export { StoredFile, JsonStoredFile, TextStoredFile } from './stored-file.ts';
export {
    AllowedFiles,
    isTextFile,
    validateJsonFile,
    type AllowedFile,
    type JsonFile,
    type JsonFileTypeMap,
    type TextFile,
} from './types.ts';

/** Process-wide store. Everything that touches `files/` goes through it. */
export const fileStore = new FileStore();

/** Starts the idle sweeper. */
export function startFileStore(): void {
    fileStore.start();
}

/**
 * Stops the sweeper and writes everything still held in RAM. Deliberately not
 * wired to a signal here: `app.ts` owns the only shutdown sequence, and a second
 * handler racing it is how a `process.exit` lands before the disk write does.
 * Call this last, once nothing can dirty a file again.
 */
export async function stopFileStore(): Promise<void> {
    fileStore.stop();
    try {
        await fileStore.flushAll();
        console.log('[Storage] Flushed pending writes');
    } catch (error) {
        console.error('[Storage] Flush on shutdown failed', error);
    }
}
