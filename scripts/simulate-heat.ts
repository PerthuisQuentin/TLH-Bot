/**
 * Heat simulation script
 * Run with: tsx scripts/simulate-heat.ts
 *
 * Tweak the parameters below to explore different behaviours.
 */

import {
    DECAY_LAMBDA,
    MIN_CONTRIBUTION,
    HeatState,
    createHeatState,
    heatToMultiplier,
    recordActivity,
    advanceDecay,
} from '../app/idle/core/heat/heat-config.ts';

// ── Parameters ────────────────────────────────────────────────────────────────

const BASE_SHELLS = 10; // shellsPerMessage baseline for display

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

function heatBar(heat: number, maxHeat = 20, width = 15): string {
    const filled = Math.min(width, Math.round((heat / maxHeat) * width));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(n: number, decimals = 2): string {
    return n.toFixed(decimals).padStart(5 + decimals);
}

// Total visible width: 9 + 22 + 9 + 10 + 9 + 15 = 74 cols
function printHeader(title: string): void {
    console.log(
        `\n${BOLD}${CYAN}══ ${title} ${'═'.repeat(Math.max(0, 55 - title.length))}${RESET}`,
    );
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

function printSilence(state: HeatState, fromMs: number, toMs: number, stepS = 30): void {
    for (let t = fromMs / 1000 + stepS; t <= toMs / 1000; t += stepS) {
        const heat = advanceDecay(state, t * 1000);
        printRow(t, '(silence)', heat, true);
    }
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

// 1. Solo user — no bonus expected
{
    printHeader('Scenario 1 — Solo user');
    const s = createHeatState(0);
    for (let i = 0; i < 20; i++) {
        const t = i * 10;
        const heat = recordActivity(s, 'user1', t * 1000);
        printRow(t, 'user1 posts', heat);
    }
}

// 2. Two users alternating every 20 s
{
    printHeader('Scenario 2 — 2 users alternating (5 s)');
    const s = createHeatState(0);
    const users = ['Noug', 'Wino'];
    for (let i = 0; i < 30; i++) {
        const t = i * 5;
        const heat = recordActivity(s, users[i % 2], t * 1000);
        printRow(t, `${users[i % 2]} posts`, heat);
    }
}

// 3. 4 users in an active conversation (one message every 10–15 s, rotating)
{
    printHeader('Scenario 3 — 4 users active conv (5–10 s)');
    const s = createHeatState(0);
    const users = ['Liline', 'Wino', 'La Noug', 'Cindoush'];
    const intervals = [5, 7, 6, 8, 5, 9, 6, 7, 5, 8, 6, 5, 7, 9, 6, 8, 5, 7, 6, 8];
    let t = 0;
    for (let i = 0; i < intervals.length; i++) {
        const heat = recordActivity(s, users[i % 4], t * 1000);
        printRow(t, `${users[i % 4]} posts`, heat);
        t += intervals[i];
    }
    // Then show the cool-down
    printSilence(s, t * 1000, (t + 300) * 1000, 60);
}

// 4. 8 users: progressive ramp-up, sustained peak, then cool-down
{
    printHeader('Scenario 4 — 8 users, progressive then silence');
    const s = createHeatState(0);

    // Users join one by one, realistic gaps
    const events: [number, string][] = [
        // Progressive arrivals
        [0, 'Liline'],
        [8, 'Wino'],
        [14, 'La Noug'],
        [20, 'Cindoush'],
        [28, 'Tintin'],
        [35, 'Floflo'],
        [41, 'Roro'],
        [48, 'Beber'],
        // Conversation at full speed
        [55, 'Liline'],
        [62, 'Wino'],
        [68, 'Tintin'],
        [75, 'La Noug'],
        [81, 'Cindoush'],
        [87, 'Roro'],
        [93, 'Beber'],
        [99, 'Floflo'],
        [106, 'Liline'],
        [112, 'Wino'],
        [118, 'Tintin'],
        [125, 'La Noug'],
        [131, 'Cindoush'],
        [137, 'Roro'],
        [143, 'Beber'],
        [149, 'Floflo'],
        [156, 'Liline'],
        [162, 'Wino'],
        [169, 'Tintin'],
        [175, 'La Noug'],
        // Conversation starts to slow down
        [200, 'Cindoush'],
        [230, 'Liline'],
        [270, 'Wino'],
        [330, 'La Noug'],
    ];

    for (const [t, user] of events) {
        const heat = recordActivity(s, user, t * 1000);
        printRow(t, `${user} posts`, heat);
    }

    const lastT = events[events.length - 1][0];
    printSilence(s, lastT * 1000, (lastT + 420) * 1000, 60);
}

// 5. One user floods (cooldown would prevent this in prod, shown for reference)
{
    printHeader('Scenario 5 — Flood by single user (×1.0 stays flat)');
    const s = createHeatState(0);
    for (let i = 0; i < 12; i++) {
        const t = i * 5;
        const heat = recordActivity(s, 'spammer', t * 1000);
        printRow(t, 'spammer posts', heat);
    }
}

// 6. λ sensitivity: show halving times for common values
{
    console.log(
        `\n${BOLD}${CYAN}══ λ reference — contribution half-life ${'═'.repeat(22)}${RESET}`,
    );
    console.log(
        DIM +
            `${'λ'.padStart(10)}  ${'half-life'.padStart(12)}  ${'~0 (×0.01)'.padStart(14)}` +
            RESET,
    );
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
