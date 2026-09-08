// Decay constant (per second). With λ = 0.006, a contribution halves in ~116 s.
export const DECAY_LAMBDA = 0.006;

// Contributions below this threshold are pruned on the next event in their channel.
export const MIN_CONTRIBUTION = 0.01;

// How much a single message adds to a user's contribution (capped at MAX_CONTRIBUTION).
// A user needs 10 back-to-back messages to reach MAX_CONTRIBUTION, more once decay sets in.
export const MSG_INCREMENT = 0.5;

// How much a single reaction adds to a user's contribution.
export const REACTION_INCREMENT = 0.1;

// Maximum contribution a single user can accumulate.
export const MAX_CONTRIBUTION = 5.0;

// Past this much silence every contribution has provably decayed below MIN_CONTRIBUTION,
// so the whole state is indistinguishable from a fresh one: ~17 min with the constants above.
export const IDLE_CHANNEL_MS =
    (Math.log(MAX_CONTRIBUTION / MIN_CONTRIBUTION) / DECAY_LAMBDA) * 1000;

export type HeatState = {
    contributions: Map<string, number>; // userId → current contribution (0–MAX_CONTRIBUTION)
    lastDecayAt: number; // ms timestamp of the last decay pass
};

export function createHeatState(nowMs: number): HeatState {
    return { contributions: new Map(), lastDecayAt: nowMs };
}

export function heatToMultiplier(heat: number): number {
    if (heat < 0.5) return 1.0; // solo ou démarrage
    if (heat < 2) return 1.2; // duo qui commence
    if (heat < 4) return 1.4; // duo modéré
    if (heat < 8) return 1.6; // duo soutenu ou 4 users démarrage
    if (heat < 12) return 1.8; // 4 users actifs
    return 2.0; // 4+ users soutenu, 8 users
}

/** Decays every contribution to `nowMs` and drops those that fall under the threshold. */
function applyDecay(state: HeatState, nowMs: number): void {
    const deltaSeconds = (nowMs - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);
    state.lastDecayAt = nowMs;

    for (const [uid, c] of state.contributions) {
        const decayed = c * decayFactor;
        if (decayed < MIN_CONTRIBUTION) state.contributions.delete(uid);
        else state.contributions.set(uid, decayed);
    }
}

/** Sum over pairs: several talkers beat one spammer holding the same total contribution. */
function pairwiseHeat(state: HeatState): number {
    let sum = 0,
        sumSq = 0;
    for (const c of state.contributions.values()) {
        sum += c;
        sumSq += c * c;
    }
    return (sum * sum - sumSq) / 2;
}

/**
 * Applies pending decay to `state`, records a new activity from `userId`,
 * and returns the total raw heat.
 */
export function recordActivity(
    state: HeatState,
    userId: string,
    nowMs: number,
    increment = MSG_INCREMENT,
): number {
    applyDecay(state, nowMs);

    const current = state.contributions.get(userId) ?? 0;
    state.contributions.set(userId, Math.min(MAX_CONTRIBUTION, current + increment));

    return pairwiseHeat(state);
}

/**
 * Applies pending decay to `state` without recording an activity,
 * and returns the total raw heat.
 */
export function advanceDecay(state: HeatState, nowMs: number): number {
    applyDecay(state, nowMs);
    return pairwiseHeat(state);
}
