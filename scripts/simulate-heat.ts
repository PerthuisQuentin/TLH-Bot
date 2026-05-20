/**
 * Heat simulation script
 * Run with: tsx scripts/simulate-heat.ts
 *
 * Tweak the parameters below to explore different behaviours.
 */

// ── Parameters ────────────────────────────────────────────────────────────────

const DECAY_LAMBDA = 0.008; // per second — controls cooling speed
const MIN_CONTRIBUTION = 0.01;

function heatToMultiplier(heat: number): number {
    if (heat < 1.5) return 1.0;
    if (heat < 2) return 1.2;
    if (heat < 3) return 1.4;
    if (heat < 4) return 1.6;
    if (heat < 7) return 1.8;
    return 2.0;
}

const BASE_SHELLS = 10; // shellsPerMessage baseline for display

// ── Heat engine (same logic as channel-activity.ts, time-injectable for sim) ──

type SimState = { contributions: Map<string, number>; lastDecayAt: number };

function createState(nowMs: number): SimState {
    return { contributions: new Map(), lastDecayAt: nowMs };
}

function postMessage(state: SimState, userId: string, nowMs: number): number {
    const deltaSeconds = (nowMs - state.lastDecayAt) / 1000;
    const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

    for (const [uid, c] of state.contributions) {
        const decayed = c * decayFactor;
        if (decayed < MIN_CONTRIBUTION) state.contributions.delete(uid);
        else state.contributions.set(uid, decayed);
    }

    state.lastDecayAt = nowMs;
    state.contributions.set(userId, 1.0);

    let heat = 0;
    for (const c of state.contributions.values()) heat += c;
    return heat;
}

// ── Display helpers ───────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';

function multiplierColor(m: number): string {
    if (m >= 2.0) return RED;
    if (m >= 1.6) return MAGENTA;
    if (m >= 1.2) return YELLOW;
    return GREEN;
}

function heatBar(heat: number, maxHeat = 6, width = 15): string {
    const filled = Math.round((heat / maxHeat) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(n: number, decimals = 2): string {
    return n.toFixed(decimals).padStart(5 + decimals);
}

// Total visible width: 9 + 22 + 9 + 10 + 9 + 15 = 74 cols
function printHeader(title: string): void {
    console.log(`\n${BOLD}${CYAN}══ ${title} ${'═'.repeat(Math.max(0, 55 - title.length))}${RESET}`);
    console.log(
        `${DIM}${'t(s)'.padStart(6)}  ${'event'.padEnd(20)}  ${'heat'.padStart(6)}  ${'×mult'.padStart(6)}  ${'~shells'.padStart(7)}  bar${RESET}`,
    );
    console.log(DIM + '─'.repeat(74) + RESET);
}

function printRow(t: number, event: string, heat: number, dim = false): void {
    const mult = heatToMultiplier(heat);
    const shells = Math.round(BASE_SHELLS * mult);
    const mc = dim ? DIM : multiplierColor(mult);
    const rowDim = dim ? DIM : '';
    console.log(
        `${rowDim}${String(t).padStart(6)}s  ${event.padEnd(20)}  ${fmt(heat, 2)}  ${mc}×${fmt(mult, 2)}${RESET}  ${String(shells).padStart(7)}  ${rowDim}${heatBar(heat)}${RESET}`,
    );
}

function printSilence(state: SimState, fromMs: number, toMs: number, stepS = 30): void {
    for (let t = fromMs / 1000 + stepS; t <= toMs / 1000; t += stepS) {
        const nowMs = t * 1000;
        const deltaSeconds = (nowMs - state.lastDecayAt) / 1000;
        const decayFactor = Math.exp(-DECAY_LAMBDA * deltaSeconds);

        let heat = 0;
        for (const c of state.contributions.values()) heat += c * decayFactor;

        // Advance state lazily (no message, just peek)
        state.lastDecayAt = nowMs;
        for (const [uid, c] of state.contributions) {
            const d = c * decayFactor;
            if (d < MIN_CONTRIBUTION) state.contributions.delete(uid);
            else state.contributions.set(uid, d);
        }

        printRow(t, '(silence)', heat, true);
    }
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

// 1. Solo user — no bonus expected
{
    printHeader('Scenario 1 — Solo user');
    const s = createState(0);
    for (let i = 0; i < 5; i++) {
        const t = i * 30;
        const heat = postMessage(s, 'user1', t * 1000);
        printRow(t, 'user1 posts', heat);
    }
}

// 2. Two users alternating every 20 s
{
    printHeader('Scenario 2 — 2 users alternating (20 s)');
    const s = createState(0);
    const users = ['Noug', 'Wino'];
    for (let i = 0; i < 8; i++) {
        const t = i * 20;
        const heat = postMessage(s, users[i % 2], t * 1000);
        printRow(t, `${users[i % 2]} posts`, heat);
    }
}

// 3. 4 users in an active conversation (one message every 10–15 s, rotating)
{
    printHeader('Scenario 3 — 4 users active conv (10–15 s)');
    const s = createState(0);
    const users = ['Liline', 'Wino', 'La Noug', 'Cindoush'];
    const intervals = [10, 12, 15, 10, 13, 11, 14, 10, 12, 15];
    let t = 0;
    for (let i = 0; i < intervals.length; i++) {
        const heat = postMessage(s, users[i % 4], t * 1000);
        printRow(t, `${users[i % 4]} posts`, heat);
        t += intervals[i];
    }
    // Then show the cool-down
    printSilence(s, t * 1000, (t + 300) * 1000, 60);
}

// 4. 8 users: progressive ramp-up, sustained peak, then cool-down
{
    printHeader('Scenario 4 — 8 users, progressive then silence');
    const s = createState(0);

    // Users join one by one, realistic gaps
    const events: [number, string][] = [
        // Progressive arrivals
        [0, 'Liline'],
        [22, 'Wino'],
        [38, 'La Noug'],
        [55, 'Cindoush'],
        [75, 'Tintin'],
        [90, 'Floflo'],
        [110, 'Roro'],
        [128, 'Beber'],
        // Conversation at full speed
        [145, 'Liline'],
        [157, 'Wino'],
        [172, 'Tintin'],
        [184, 'La Noug'],
        [197, 'Cindoush'],
        [210, 'Roro'],
        [222, 'Beber'],
        [235, 'Floflo'],
        // Conversation starts to slow down
        [275, 'Liline'],
        [320, 'Wino'],
        [390, 'La Noug'],
    ];

    for (const [t, user] of events) {
        const heat = postMessage(s, user, t * 1000);
        printRow(t, `${user} posts`, heat);
    }

    const lastT = events[events.length - 1][0];
    printSilence(s, lastT * 1000, (lastT + 420) * 1000, 60);
}

// 5. One user floods (cooldown would prevent this in prod, shown for reference)
{
    printHeader('Scenario 5 — Flood by single user (×1.0 stays flat)');
    const s = createState(0);
    for (let i = 0; i < 6; i++) {
        const t = i * 5;
        const heat = postMessage(s, 'spammer', t * 1000);
        printRow(t, 'spammer posts', heat);
    }
}

// 6. λ sensitivity: show halving times for common values
{
    console.log(`\n${BOLD}${CYAN}══ λ reference — contribution half-life ${'═'.repeat(22)}${RESET}`);
    console.log(DIM + `${'λ'.padStart(10)}  ${'half-life'.padStart(12)}  ${'~0 (×0.01)'.padStart(14)}` + RESET);
    console.log(DIM + '─'.repeat(42) + RESET);
    for (const λ of [0.003, 0.005, 0.008, 0.012, 0.02]) {
        const halfLife = Math.log(2) / λ;
        const zeroTime = Math.log(1 / MIN_CONTRIBUTION) / λ;
        const marker = λ === DECAY_LAMBDA ? ` ${YELLOW}← current${RESET}` : '';
        console.log(
            `${String(λ).padStart(10)}  ${Math.round(halfLife).toString().padStart(9)} s  ${Math.round(zeroTime).toString().padStart(11)} s${marker}`,
        );
    }
}

console.log('');
