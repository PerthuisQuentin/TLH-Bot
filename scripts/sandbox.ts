/**
 * Interactive idle sandbox: the shells game alone, on a compressed clock, with no Discord and
 * no storage.
 *
 *   tsx scripts/sandbox.ts [--messages-per-day=500] [--speed=0.25] [--auto] [--frames=N]
 *
 * Where `simulate-idle.ts` and `simulate-prestige.ts` answer "what do these curves produce
 * over a year", this one answers "what does it feel like to play them". Time runs on a virtual
 * clock, messages arrive on their own, and the purchases are yours.
 *
 * Everything the game decides is read from `app/idle/core/`: incomes, prices, the coral
 * formula, what a prestige resets. The script owns the clock and the keyboard, nothing else.
 *
 * **Messages only.** Heat, the streak and passive income are folded into the message rate, the
 * same convention `simulate-idle.ts` uses: they key off wall-clock dates that a virtual clock
 * cannot drive honestly, so the sandbox does not pretend to model them.
 */

import { GameInstance } from '../app/idle/core/game-instance.ts';
import { ALL_UPGRADE_IDS } from '../app/idle/core/upgrades/upgrade-registry.ts';
import { ResourceId, UpgradeId } from '../app/idle/core/types.ts';
import { RESOURCE_META, formatResource } from '../app/idle/core/resources.ts';
import { bnCeil, bnGte, bnMul, formatBigNum } from '../app/idle/core/big-number.ts';
import { numberArg, spendCoral, tryBuy } from './sim-common.ts';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Virtual days per real second. The list the `+` and `-` keys walk through. */
const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

/** Purchase sizes the `x` key cycles through. `null` means "as many as the balance covers". */
const QUANTITIES: Array<number | null> = [1, 10, null];

/** Raw mode delivers Ctrl+C as a byte rather than a signal, so it is handled with the keys. */
const CTRL_C = '\u0003';

const TICK_MS = 100;
const FRAME_EVERY_TICKS = 2;
const LOG_LINES = 8;

type Config = {
    messagesPerDay: number;
    speedIndex: number;
    auto: boolean;
    /** Headless: render this many frames and exit, for a terminal-less check. */
    frames: number | null;
};

function parseArgs(argv: string[]): Config {
    const config: Config = {
        messagesPerDay: 500,
        speedIndex: SPEEDS.indexOf(0.25),
        auto: false,
        frames: null,
    };

    for (const arg of argv) {
        if (arg === '--auto') {
            config.auto = true;
            continue;
        }

        const messages = numberArg(arg, '--messages-per-day=');
        if (messages !== null && messages > 0) {
            config.messagesPerDay = messages;
            continue;
        }

        const speed = numberArg(arg, '--speed=');
        if (speed !== null && speed > 0) {
            // Nearest listed speed, so `+` and `-` keep working from wherever it started.
            config.speedIndex = SPEEDS.reduce(
                (best, value, index) =>
                    Math.abs(value - speed) < Math.abs(SPEEDS[best] - speed) ? index : best,
                0,
            );
            continue;
        }

        const frames = numberArg(arg, '--frames=');
        if (frames !== null && frames > 0) config.frames = Math.floor(frames);
    }

    return config;
}

// ─── State ───────────────────────────────────────────────────────────────────

const config = parseArgs(process.argv.slice(2));

let instance = GameInstance.newInstance('sandbox');
let day = 0;
/** Messages owed but not yet whole. A tick at low speed earns a fraction of one. */
let messageCarry = 0;
let paused = false;
let quantityIndex = 0;
const log: string[] = [];

function note(message: string): void {
    log.push(`j${day.toFixed(1).padStart(6)}  ${message}`);
    if (log.length > LOG_LINES) log.shift();
}

function reset(): void {
    instance = GameInstance.newInstance('sandbox');
    day = 0;
    messageCarry = 0;
    log.length = 0;
    note('sandbox reset');
}

// ─── The clock ───────────────────────────────────────────────────────────────

function tick(): void {
    if (paused) return;

    const elapsedDays = SPEEDS[config.speedIndex] * (TICK_MS / 1000);
    day += elapsedDays;

    messageCarry += config.messagesPerDay * elapsedDays;
    const messages = Math.floor(messageCarry);
    if (messages > 0) {
        messageCarry -= messages;
        instance.applyShellsGain(messages);
    }

    if (config.auto) {
        while (tryBuy(instance, 'cheapest') !== null);
        // Only the coral half is logged. Shell purchases land several times a second at any
        // useful speed, and would push everything else out of the log.
        noteCoralPurchases(spendCoral);
    }
}

/** Runs `spend` and logs which coral upgrades gained levels, if any. */
function noteCoralPurchases(spend: (instance: GameInstance) => void): void {
    const coralIds = ALL_UPGRADE_IDS.filter(
        (id) => instance.upgrades[id].costResourceId === ResourceId.CORAL,
    );
    const before = coralIds.map((id) => instance.upgrades[id].level);

    spend(instance);

    const gained = coralIds
        .map((id, index) => ({ id, from: before[index], to: instance.upgrades[id].level }))
        .filter((entry) => entry.to > entry.from);

    for (const entry of gained) {
        note(`${instance.upgrades[entry.id].name} ${entry.from} -> ${entry.to}`);
    }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * How many levels the current quantity mode buys of `index`, and what they cost. Capped at
 * what the balance covers rather than refused like `/shop` does: in a sandbox, "buy 10" with
 * eight affordable should buy eight instead of making the player count.
 */
function plannedPurchase(index: number): { levels: number; cost: ReturnType<typeof bnCeil> } {
    const upgrade = instance.upgrades[ALL_UPGRADE_IDS[index]];
    const balance = instance.resources[upgrade.costResourceId];
    const wanted = QUANTITIES[quantityIndex];

    const affordable = upgrade.getMaxBuyable(balance);
    if (wanted === null) return { levels: affordable.levels, cost: bnCeil(affordable.totalCost) };

    const levels = Math.min(wanted, affordable.levels);
    return { levels, cost: bnCeil(upgrade.getTotalCost(levels)) };
}

function buy(index: number): void {
    if (index < 0 || index >= ALL_UPGRADE_IDS.length) return;

    const id = ALL_UPGRADE_IDS[index];
    const upgrade = instance.upgrades[id];
    const { levels } = plannedPurchase(index);

    if (levels === 0) {
        note(`${upgrade.name}: cannot afford one level`);
        return;
    }

    const before = upgrade.level;
    const result = instance.buyUpgrade(id, levels);
    if (!result) return;

    note(
        `${upgrade.name} ${before} -> ${result.newLevel} for ${formatResource(bnCeil(result.totalCost), upgrade.costResourceId)}`,
    );
}

function prestige(): void {
    const preview = instance.previewPrestige();
    if (!preview.unlocked) {
        note(`prestige locked: buy ${instance.upgrades[UpgradeId.CORAL_SEEDLING].name} first`);
        return;
    }
    if (!preview.canPrestige) {
        note(
            `prestige refused: ${formatResource(preview.shellsMissing, ResourceId.SHELLS)} of run peak missing`,
        );
        return;
    }

    const peak = instance.stats.runMaxShells;
    const outcome = instance.prestige();
    if (!outcome) return;

    note(
        `PRESTIGE ${outcome.prestigeCount}: ${formatResource(peak, ResourceId.SHELLS)} -> ${formatResource(outcome.coral, ResourceId.CORAL)}`,
    );
}

function handleKey(key: string): void {
    if (key === 'q' || key === CTRL_C) {
        stop();
        return;
    }

    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= ALL_UPGRADE_IDS.length) {
        buy(digit - 1);
        return;
    }

    switch (key) {
        case ' ':
            paused = !paused;
            break;
        case 'x':
            quantityIndex = (quantityIndex + 1) % QUANTITIES.length;
            break;
        case 'a':
            config.auto = !config.auto;
            note(config.auto ? 'auto-buy on' : 'auto-buy off');
            break;
        case 'p':
            prestige();
            break;
        case '+':
        case '=':
            config.speedIndex = Math.min(SPEEDS.length - 1, config.speedIndex + 1);
            break;
        case '-':
            config.speedIndex = Math.max(0, config.speedIndex - 1);
            break;
        case 'r':
            reset();
            break;
    }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const HOME = '\u001b[H';
const CLEAR_LINE = '\u001b[K';
const CLEAR_BELOW = '\u001b[J';
const CLEAR_SCREEN = '\u001b[2J';

function quantityLabel(): string {
    const wanted = QUANTITIES[quantityIndex];
    return wanted === null ? 'max' : String(wanted);
}

function pad(text: string, width: number): string {
    // Emoji count as one code point but two columns in every terminal that matters here.
    const visible = [...text].length + [...text].filter((c) => c.codePointAt(0)! > 0x2100).length;
    // At least one space: a value wider than its column must not run into the next one.
    return text + ' '.repeat(Math.max(1, width - visible));
}

function upgradeLines(): string[] {
    return ALL_UPGRADE_IDS.map((id, index) => {
        const upgrade = instance.upgrades[id];
        const currency = upgrade.costResourceId;
        const price = bnCeil(upgrade.getCost());
        const affordable = bnGte(instance.resources[currency], price);
        const { levels } = plannedPurchase(index);

        const buyable = affordable ? `x${levels}` : '--';

        return [
            ` ${index + 1} `,
            pad(`${upgrade.emoji} ${upgrade.name}`, 30),
            pad(`niv ${upgrade.level}`, 8),
            pad(upgrade.formatGain(), 16),
            pad(formatResource(price, currency), 14),
            pad(buyable, 4),
        ].join('');
    });
}

function header(): string[] {
    const income = instance.income[ResourceId.SHELLS];
    const perDay = bnMul(income, config.messagesPerDay);
    const coral = instance.resources[ResourceId.CORAL];
    const multiplier = instance.coralMultiplier;

    return [
        `TLH idle sandbox   day ${day.toFixed(1)}   ${SPEEDS[config.speedIndex]} day/s   ` +
            `${config.messagesPerDay} msg/day   auto ${config.auto ? 'on' : 'off'}   ` +
            `buy ${quantityLabel()}${paused ? '   [PAUSED]' : ''}`,
        '',
        `  ${pad(RESOURCE_META[ResourceId.SHELLS].displayName, 14)}${pad(formatResource(instance.resources[ResourceId.SHELLS], ResourceId.SHELLS), 16)}` +
            `income ${formatBigNum(income)}/msg   ${formatBigNum(perDay)}/day`,
        `  ${pad(RESOURCE_META[ResourceId.CORAL].displayName, 14)}${pad(formatResource(coral, ResourceId.CORAL), 16)}` +
            `prestiges ${instance.stats.prestigeCount}   coral x${formatBigNum(multiplier)}`,
    ];
}

function prestigeLine(): string {
    const preview = instance.previewPrestige();
    const peak = formatResource(instance.stats.runMaxShells, ResourceId.SHELLS);

    // Unlike Discord, the sandbox says so rather than hiding it: the point here is to watch
    // the numbers, not to preserve the discovery.
    if (!preview.unlocked) {
        const seedling = instance.upgrades[UpgradeId.CORAL_SEEDLING];
        return `  [p] prestige: locked, ${seedling.name} costs ${formatResource(bnCeil(seedling.getCost()), seedling.costResourceId)}`;
    }

    return preview.canPrestige
        ? `  [p] prestige: run peak ${peak} -> ${formatResource(preview.coral, ResourceId.CORAL)}`
        : `  [p] prestige: run peak ${peak}, ${formatResource(preview.shellsMissing, ResourceId.SHELLS)} short of the first 🪸`;
}

function frame(decorated = true): string {
    const lines = [
        ...header(),
        '',
        ...upgradeLines(),
        '',
        prestigeLine(),
        '',
        ...log,
        ...Array<string>(Math.max(0, LOG_LINES - log.length)).fill(''),
        '',
        '  [1-9] buy   [x] quantity   [a] auto   [p] prestige   [+/-] speed   [space] pause   [r] reset   [q] quit',
    ];

    // The clear-to-end-of-line is what keeps a shorter frame from leaving the previous one
    // behind. It is only noise when the frames are being read rather than watched.
    return lines.map((line) => (decorated ? line + CLEAR_LINE : line.trimEnd())).join('\n');
}

function render(): void {
    process.stdout.write(HOME + frame() + '\n' + CLEAR_BELOW);
}

// ─── Loop ────────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | undefined;

/**
 * This script owns its own terminal, unlike the bot: `app.ts` is the process that must keep a
 * single shutdown path. Raw mode has to be given back, or the shell that launched this is left
 * without an echo.
 */
function stop(): void {
    if (timer) clearInterval(timer);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
    process.exit(0);
}

function main(): void {
    if (config.frames !== null) {
        for (let i = 0; i < config.frames; i += 1) {
            tick();
            if (i % FRAME_EVERY_TICKS === 0) console.log(frame(false) + '\n');
        }
        return;
    }

    if (!process.stdin.isTTY) {
        console.error(
            'sandbox.ts needs an interactive terminal. Use --frames=N to render without one.',
        );
        process.exitCode = 1;
        return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
        for (const key of chunk) handleKey(key);
        render();
    });
    process.on('SIGINT', stop);

    process.stdout.write(CLEAR_SCREEN);
    note(`started at ${config.messagesPerDay} msg/day`);

    let ticks = 0;
    timer = setInterval(() => {
        tick();
        ticks += 1;
        if (ticks % FRAME_EVERY_TICKS === 0) render();
    }, TICK_MS);
}

main();
