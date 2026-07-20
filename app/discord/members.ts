import { client } from './setup.ts';
import type { DisplayNameResolver } from './types.ts';

/**
 * REST message payloads carry no member object — Discord only attaches one to gateway
 * events — so nicknames for a fetched history come from the gateway's member cache.
 * `known` covers ids the caller already holds a name for, such as the interaction author.
 */
export function guildDisplayNameResolver(
    guildId: string,
    known: Map<string, string> = new Map(),
): DisplayNameResolver {
    const guild = client.guilds.cache.get(guildId);
    return (userId) => known.get(userId) ?? guild?.members.cache.get(userId)?.displayName ?? null;
}
