// Decay constant (per second). With λ = 0.006, a contribution halves in ~116 s.
export const DECAY_LAMBDA = 0.006;

// Entries below this threshold are pruned to avoid memory leaks in silent channels.
export const MIN_CONTRIBUTION = 0.01;

// How much a single message adds to a user's contribution (capped at MAX_CONTRIBUTION).
// A user needs ~7 messages in quick succession to reach full contribution.
export const MSG_INCREMENT = 0.5;

// Maximum contribution a single user can accumulate.
export const MAX_CONTRIBUTION = 5.0;

export type HeatState = {
    contributions: Map<string, number>; // userId → current contribution (0–1)
    lastDecayAt: number;                // ms timestamp of the last decay pass
};

export function createHeatState(nowMs: number): HeatState {
    return { contributions: new Map(), lastDecayAt: nowMs };
}

export function heatToMultiplier(heat: number): number {
    if (heat < 0.5) return 1.0;  // solo ou démarrage
    if (heat < 2) return 1.2;    // duo qui commence
    if (heat < 4) return 1.4;    // duo modéré
    if (heat < 8) return 1.6;    // duo soutenu ou 4 users démarrage
    if (heat < 12) return 1.8;   // 4 users actifs
    return 2.0;                  // 4+ users soutenu, 8 users
}

/**
 * Applies exponential decay to `state`, records a new message from `userId`,
 * and returns the total raw heat.
 */
export function recordMessage(state: HeatState, userId: string, nowMs: number): number {
    const deltaSeconds = (nowMs - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

    for (const [uid, c] of state.contributions) {
        const decayed = c * decayFactor;
        if (decayed < MIN_CONTRIBUTION) state.contributions.delete(uid);
        else state.contributions.set(uid, decayed);
    }

    state.lastDecayAt = nowMs;
    const current = state.contributions.get(userId) ?? 0;
    state.contributions.set(userId, Math.min(MAX_CONTRIBUTION, current + MSG_INCREMENT));

    let sum = 0, sumSq = 0;
    for (const c of state.contributions.values()) { sum += c; sumSq += c * c; }
    return (sum * sum - sumSq) / 2;
}

/**
 * Applies exponential decay to `state` without recording a new message,
 * and returns the total raw heat. Prunes stale entries.
 */
export function advanceDecay(state: HeatState, nowMs: number): number {
    const deltaSeconds = (nowMs - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

    state.lastDecayAt = nowMs;

    let heat = 0;
    for (const [uid, c] of state.contributions) {
        const decayed = c * decayFactor;
        if (decayed < MIN_CONTRIBUTION) state.contributions.delete(uid);
        else state.contributions.set(uid, decayed);
    }

    let sum = 0, sumSq = 0;
    for (const c of state.contributions.values()) { sum += c; sumSq += c * c; }
    return (sum * sum - sumSq) / 2;
}
