import { oceanKey, renderOcean } from './render.ts';
import type { OceanLevels } from './types.ts';

/** ~10 KB a scene, so about 2.5 MB at most. */
const OCEAN_CACHE_SIZE = 256;

type Render = (levels: Partial<OceanLevels>) => Buffer<ArrayBuffer>;

/**
 * `render`, remembering the `size` most recently used scenes. A key always renders the same
 * bytes, so an entry never goes stale: the bound is for memory.
 */
export function createOceanCache(size: number, render: Render = renderOcean): Render {
    // A Map iterates in insertion order, so re-inserting on a hit keeps the oldest use first.
    const cache = new Map<string, Buffer<ArrayBuffer>>();
    return (levels) => {
        const key = oceanKey(levels);
        const hit = cache.get(key);
        if (hit) {
            cache.delete(key);
            cache.set(key, hit);
            return hit;
        }
        const png = render(levels);
        cache.set(key, png);
        if (cache.size > size) cache.delete(cache.keys().next().value!);
        return png;
    };
}

export const renderOceanCached = createOceanCache(OCEAN_CACHE_SIZE);
