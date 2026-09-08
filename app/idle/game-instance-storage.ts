import { fileStore, AllowedFiles } from '../storage/index.ts';
import { GameInstance, type ReadonlyGameInstance } from './core/game-instance.ts';

/**
 * A detached snapshot: mutating it would persist nothing, hence the read-only view.
 * Changing a player goes through `updateGameInstance` below.
 */
export async function getGameInstance(
    guildId: string,
    userId: string,
): Promise<ReadonlyGameInstance> {
    const instances = await fileStore.readJson(guildId, AllowedFiles.GAME_INSTANCES);
    const data = instances.find((i) => i.userId === userId);
    return data ? new GameInstance(data) : GameInstance.newInstance(userId);
}

/** Same detached snapshots as `getGameInstance`, for the whole guild. */
export async function getAllGameInstances(guildId: string): Promise<ReadonlyGameInstance[]> {
    const instances = await fileStore.readJson(guildId, AllowedFiles.GAME_INSTANCES);
    return instances.map((data) => new GameInstance(data));
}

/**
 * The only sanctioned way to change a player, and the change has to happen inside `mutate`:
 *
 * - `mutate` runs synchronously between the load and the write-back, which is what makes
 *   the read-modify-write atomic. An `await` in it would let a concurrent event write back
 *   a stale snapshot. Whatever it returns is returned here.
 * - The instance must not escape the callback. Mutating it afterwards persists nothing —
 *   that is the very loss `ReadonlyGameInstance` closes off for the readers above.
 * - The write is deferred by ~1 s; `flushGameInstances` forces it when the player has been
 *   told the change succeeded.
 * - A player absent from the file is created here, so callers never pre-register one.
 */
export async function updateGameInstance<R>(
    guildId: string,
    userId: string,
    mutate: (instance: GameInstance) => R,
): Promise<R> {
    return fileStore.updateJson(guildId, AllowedFiles.GAME_INSTANCES, (instances) => {
        const index = instances.findIndex((i) => i.userId === userId);
        const instance =
            index >= 0 ? new GameInstance(instances[index]) : GameInstance.newInstance(userId);

        const result = mutate(instance);

        const json = instance.toJson();
        if (index >= 0) instances[index] = json;
        else instances.push(json);

        return result;
    });
}

/** Forces the guild's instances to disk, for changes a player is told succeeded. */
export async function flushGameInstances(guildId: string): Promise<void> {
    await fileStore.flush(guildId, AllowedFiles.GAME_INSTANCES);
}
