const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `task` only after every previously enqueued task for the same guildId has
 * settled, so a guild-scoped read-then-write cycle (AI memory) never interleaves with
 * another. Mirrors the write-chaining in StoredFile.flush() (app/storage/stored-file.ts):
 * the stored promise is always the unswallowed `next`, and a rejection is only ever
 * caught by the *next* caller reading it off the map — so one failure never blocks a
 * later task for the same guild, but the immediate caller still sees the real error.
 */
export function enqueueForGuild<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(guildId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(guildId, next);
    return next;
}
