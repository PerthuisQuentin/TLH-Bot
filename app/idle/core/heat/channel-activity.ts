import {
    HeatState,
    createHeatState,
    heatToMultiplier,
    recordActivity,
    advanceDecay,
    MSG_INCREMENT,
    REACTION_INCREMENT,
    IDLE_CHANNEL_MS,
} from './heat-config.ts';
import { ChannelActivityType } from '../types.ts';

const ACTIVITY_INCREMENTS: Record<ChannelActivityType, number> = {
    [ChannelActivityType.Message]: MSG_INCREMENT,
    [ChannelActivityType.Reaction]: REACTION_INCREMENT,
};

const channelStates = new Map<string, HeatState>();

// How often the map is walked. Contribution pruning only ever runs on a channel that gets
// an event, so a channel that goes dead needs someone else's event to be cleaned up.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let lastSweepAt = 0;

/**
 * Drops channels silent past IDLE_CHANNEL_MS. Behaviour-preserving: every contribution of
 * such a channel is already below the prune threshold, so recreating the state on the next
 * event yields the same zero heat. Returns how many entries were dropped.
 */
export function sweepIdleChannels(nowMs: number): number {
    let dropped = 0;
    for (const [channelId, state] of channelStates) {
        if (nowMs - state.lastDecayAt <= IDLE_CHANNEL_MS) continue;
        channelStates.delete(channelId);
        dropped++;
    }
    return dropped;
}

/**
 * Records an activity from `userId` in `channelId`, applies the exponential decay
 * to all existing contributions, then returns the current activity multiplier.
 *
 * Designed to be called lazily on every event — no background loop needed.
 */
export function updateChannelHeat(
    channelId: string,
    userId: string,
    activityType: ChannelActivityType = ChannelActivityType.Message,
): number {
    const now = Date.now();

    if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
        lastSweepAt = now;
        sweepIdleChannels(now);
    }

    if (!channelStates.has(channelId)) {
        channelStates.set(channelId, createHeatState(now));
    }

    const state = channelStates.get(channelId)!;
    return heatToMultiplier(recordActivity(state, userId, now, ACTIVITY_INCREMENTS[activityType]));
}

export type HeatSnapshot = {
    heat: number;
    multiplier: number;
    contributors: Array<{ userId: string; contribution: number }>;
};

/**
 * Returns the current heat state of a channel without recording a new message.
 * Applies pending decay lazily, same as updateChannelHeat.
 */
export function getChannelHeatSnapshot(channelId: string): HeatSnapshot {
    const now = Date.now();
    const state = channelStates.get(channelId);

    if (!state || state.contributions.size === 0) {
        return { heat: 0, multiplier: 1.0, contributors: [] };
    }

    const heat = advanceDecay(state, now);

    const contributors = [...state.contributions.entries()]
        .map(([userId, contribution]) => ({ userId, contribution }))
        .sort((a, b) => b.contribution - a.contribution);

    return { heat, multiplier: heatToMultiplier(heat), contributors };
}
