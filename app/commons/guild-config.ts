import { fileStore, AllowedFiles } from '../storage/index.ts';
import type { GuildConfig } from './types.ts';

/**
 * The guild's config, or null when it could not be read — a malformed file, not a
 * missing one, which reads back as `{}`. Both gating callers (`/ask`, spontaneous chat)
 * treat null as "not allowed here": an unreadable config must not be read as an empty
 * one, or a syntax error would silently unlock every channel it was meant to exclude.
 * They differ only in how they say no, which is why that stays with them.
 *
 * `app/idle/` reads the config directly instead: its callers own an error boundary that
 * logs and abandons the event, so swallowing the error this early would hide it.
 */
export async function readGuildConfigOrNull(guildId: string): Promise<GuildConfig | null> {
    try {
        return await fileStore.readJson(guildId, AllowedFiles.CONFIG);
    } catch (error) {
        console.error(`[Config] Error reading | guildId=${guildId}`, error);
        return null;
    }
}
