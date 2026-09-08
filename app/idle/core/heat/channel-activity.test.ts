import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
    updateChannelHeat,
    getChannelHeatSnapshot,
    sweepIdleChannels,
} from './channel-activity.ts';
import { IDLE_CHANNEL_MS } from './heat-config.ts';
import { ChannelActivityType } from '../types.ts';

// Each test uses its own channelId so the module-level state map never leaks between
// tests — there is no exported reset, and this keeps it that way.

afterEach(() => {
    vi.useRealTimers();
});

describe('updateChannelHeat', () => {
    it('gives the default x1.0 multiplier to a single contributor', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const multiplier = updateChannelHeat('chan-solo', 'u1', ChannelActivityType.Message);
        expect(multiplier).toBe(1.0);
    });

    it('reactions build heat slower than messages, at an equal call count', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        for (let i = 0; i < 3; i++) {
            updateChannelHeat('chan-messages', 'u1', ChannelActivityType.Message);
            updateChannelHeat('chan-messages', 'u2', ChannelActivityType.Message);
        }
        for (let i = 0; i < 3; i++) {
            updateChannelHeat('chan-reactions', 'u1', ChannelActivityType.Reaction);
            updateChannelHeat('chan-reactions', 'u2', ChannelActivityType.Reaction);
        }

        const messageMultiplier = getChannelHeatSnapshot('chan-messages').multiplier;
        const reactionMultiplier = getChannelHeatSnapshot('chan-reactions').multiplier;

        expect(messageMultiplier).toBeGreaterThan(reactionMultiplier);
    });

    it('keeps channels independent', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        for (let i = 0; i < 5; i++) {
            updateChannelHeat('chan-busy', 'u1', ChannelActivityType.Message);
            updateChannelHeat('chan-busy', 'u2', ChannelActivityType.Message);
        }

        expect(getChannelHeatSnapshot('chan-untouched-by-busy')).toEqual({
            heat: 0,
            multiplier: 1.0,
            contributors: [],
        });
    });
});

describe('getChannelHeatSnapshot', () => {
    it('returns the zero default for a channel that was never touched', () => {
        expect(getChannelHeatSnapshot('chan-never-seen')).toEqual({
            heat: 0,
            multiplier: 1.0,
            contributors: [],
        });
    });

    it('sorts contributors by contribution, descending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        updateChannelHeat('chan-sorted', 'u1', ChannelActivityType.Message); // 0.5
        updateChannelHeat('chan-sorted', 'u2', ChannelActivityType.Message); // 0.5
        updateChannelHeat('chan-sorted', 'u2', ChannelActivityType.Message); // 1.0
        updateChannelHeat('chan-sorted', 'u3', ChannelActivityType.Reaction); // 0.1

        const snapshot = getChannelHeatSnapshot('chan-sorted');

        expect(snapshot.contributors).toEqual([
            { userId: 'u2', contribution: 1.0 },
            { userId: 'u1', contribution: 0.5 },
            { userId: 'u3', contribution: 0.1 },
        ]);
    });
});

// Last on purpose: these advance the fake clock past IDLE_CHANNEL_MS, which would sweep
// the channels every test above relies on.
describe('sweepIdleChannels', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        // Clears what the tests above left in the module map, through the real API rather
        // than a test-only reset.
        sweepIdleChannels(Number.MAX_SAFE_INTEGER);
    });

    it('drops a channel silent past the decay horizon, once', () => {
        updateChannelHeat('chan-abandoned', 'u1', ChannelActivityType.Message);

        expect(sweepIdleChannels(IDLE_CHANNEL_MS + 1)).toBe(1);
        expect(sweepIdleChannels(IDLE_CHANNEL_MS + 1)).toBe(0);
    });

    it('keeps a channel touched just inside the horizon', () => {
        updateChannelHeat('chan-still-warm', 'u1', ChannelActivityType.Message);

        expect(sweepIdleChannels(IDLE_CHANNEL_MS - 1)).toBe(0);
    });

    // Proves the amortized call inside updateChannelHeat: nothing is left for an explicit
    // sweep to find, so the event on another channel already did the cleanup.
    it('is triggered by activity on any other channel', () => {
        updateChannelHeat('chan-forgotten', 'u1', ChannelActivityType.Message);

        vi.setSystemTime(IDLE_CHANNEL_MS + 1);
        updateChannelHeat('chan-elsewhere', 'u2', ChannelActivityType.Message);

        expect(sweepIdleChannels(IDLE_CHANNEL_MS + 1)).toBe(0);
    });
});
