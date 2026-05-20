import { HeatState, createHeatState, heatToMultiplier, recordMessage, advanceDecay } from './heat-config.js';

const channelStates = new Map<string, HeatState>();

/**
 * Records a message from `userId` in `channelId`, applies the exponential decay
 * to all existing contributions, then returns the current activity multiplier.
 *
 * Designed to be called lazily on every message — no background loop needed.
 */
export function updateChannelHeat(channelId: string, userId: string): number {
    const now = Date.now();

    if (!channelStates.has(channelId)) {
        channelStates.set(channelId, createHeatState(now));
    }

    const state = channelStates.get(channelId)!;
    return heatToMultiplier(recordMessage(state, userId, now));
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
