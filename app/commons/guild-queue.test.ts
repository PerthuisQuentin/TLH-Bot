import { describe, it, expect } from 'vitest';
import { enqueueForGuild } from './guild-queue.ts';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('enqueueForGuild', () => {
    it('runs two tasks for the same guild strictly in order', async () => {
        const order: string[] = [];
        const first = deferred<void>();

        const firstTask = enqueueForGuild('g1', async () => {
            order.push('first-start');
            await first.promise;
            order.push('first-end');
        });
        const secondTask = enqueueForGuild('g1', async () => {
            order.push('second-start');
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(['first-start']);

        first.resolve();
        await firstTask;
        await secondTask;

        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });

    it('runs tasks for different guilds concurrently', async () => {
        const order: string[] = [];
        const g1First = deferred<void>();

        const g1Task = enqueueForGuild('g1', async () => {
            order.push('g1-start');
            await g1First.promise;
            order.push('g1-end');
        });
        const g2Task = enqueueForGuild('g2', async () => {
            order.push('g2-start-and-end');
        });

        await g2Task;
        expect(order).toEqual(['g1-start', 'g2-start-and-end']);

        g1First.resolve();
        await g1Task;
        expect(order).toEqual(['g1-start', 'g2-start-and-end', 'g1-end']);
    });

    it('surfaces a rejection to its own caller without blocking the next task for the same guild', async () => {
        const failing = enqueueForGuild('g1', () => Promise.reject(new Error('boom')));
        const next = enqueueForGuild('g1', async () => 'ok');

        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toBe('ok');
    });
});
