// Decay constant (per second). With λ = 0.008, a contribution halves in ~87 s.
const DECAY_LAMBDA = 0.008;

// Entries below this threshold are pruned to avoid memory leaks in silent channels.
const MIN_CONTRIBUTION = 0.01;

type ChannelState = {
    contributions: Map<string, number>; // userId → current contribution (0–1)
    lastDecayAt: number;                // ms timestamp of the last decay pass
};

const channelStates = new Map<string, ChannelState>();

function heatToMultiplier(heat: number): number {
    if (heat < 1) return 1.0;
    if (heat < 2) return 1.2;
    if (heat < 3) return 1.4;
    if (heat < 4) return 1.6;
    if (heat < 7) return 1.8;
    return 2.0;
}

/**
 * Records a message from `userId` in `channelId`, applies the exponential decay
 * to all existing contributions, then returns the current activity multiplier.
 *
 * Designed to be called lazily on every message — no background loop needed.
 */
export function updateChannelHeat(channelId: string, userId: string): number {
    const now = Date.now();

    if (!channelStates.has(channelId)) {
        channelStates.set(channelId, { contributions: new Map(), lastDecayAt: now });
    }

    const state = channelStates.get(channelId)!;
    const deltaSeconds = (now - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

    // Apply decay to all contributions and prune stale entries.
    for (const [uid, contribution] of state.contributions) {
        const decayed = contribution * decayFactor;
        if (decayed < MIN_CONTRIBUTION) {
            state.contributions.delete(uid);
        } else {
            state.contributions.set(uid, decayed);
        }
    }

    state.lastDecayAt = now;

    // This user just sent a message: reset their contribution to full.
    state.contributions.set(userId, 1.0);

    let heat = 0;
    for (const c of state.contributions.values()) {
        heat += c;
    }

    return heatToMultiplier(heat);
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

    const deltaSeconds = (now - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

    state.lastDecayAt = now;

    let heat = 0;
    const contributors: Array<{ userId: string; contribution: number }> = [];

    for (const [uid, c] of state.contributions) {
        const decayed = c * decayFactor;
        if (decayed < MIN_CONTRIBUTION) {
            state.contributions.delete(uid);
        } else {
            state.contributions.set(uid, decayed);
            heat += decayed;
            contributors.push({ userId: uid, contribution: decayed });
        }
    }

    contributors.sort((a, b) => b.contribution - a.contribution);

    return { heat, multiplier: heatToMultiplier(heat), contributors };
}
