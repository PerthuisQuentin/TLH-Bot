import { describe, expect, it, vi } from 'vitest';
import { createOceanCache, renderOceanCached } from './cache.ts';
import { renderOcean } from './render.ts';

describe('createOceanCache', () => {
    const stubRender = () => vi.fn(() => Buffer.from('png'));

    it('renders a key once, whatever the key order or the implicit zeros', () => {
        const render = stubRender();
        const cached = createOceanCache(4, render);

        const first = cached({ otters: 2, kelp: 1 });
        expect(cached({ kelp: 1, otters: 2, bags: 0 })).toBe(first);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('drops the least recently used scene once full, and keeps one just used', () => {
        const render = stubRender();
        const cached = createOceanCache(2, render);

        cached({ shells: 1 });
        cached({ shells: 2 });
        cached({ shells: 1 }); // touched: now the most recent
        cached({ shells: 3 }); // over the size: evicts shells 2
        expect(render).toHaveBeenCalledTimes(3);

        cached({ shells: 1 });
        expect(render).toHaveBeenCalledTimes(3);
        cached({ shells: 2 });
        expect(render).toHaveBeenCalledTimes(4);
    });
});

describe('renderOceanCached', () => {
    it('renders what renderOcean renders', () => {
        const levels = { otters: 3, coral: 4 };
        expect(renderOceanCached(levels).equals(renderOcean(levels))).toBe(true);
    });
});
