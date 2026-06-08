import { bn, bnFloor, bnMul, bnFromJSON, bnGt, type BigNum } from '../commons/big-number.js';
import { getUserShellsData, setLastActiveAt, addUserShells } from './shells-storage.js';

const PLATEAU_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

/**
 * Computes the accumulated passive "shell-hours" for a given elapsed time.
 *
 * The accumulation rate is:
 *   - 1 (full, 1 msg-equivalent/h) for the first 24 h
 *   - 1 / (1 + ((t − 24) / 24)²) for t > 24 h  (Lorentzian decay)
 *
 * The integral of that rate has a closed form:
 *   - H                                    for H ≤ 24
 *   - 24 + 24 × arctan((H − 24) / 24)     for H > 24
 *
 * Properties:
 *   - Always increasing (rate is always > 0)
 *   - Full rate for the first 24 h
 *   - Halves at 48 h, drops to 20% at 72 h, ~2.7% after 1 week
 *   - Theoretical max ≈ shellsPerMessage × (24 + 12π) ≈ 61.7 shell-hours
 */
function computePassiveShellHours(hours: number): number {
    if (hours <= 0) return 0;
    if (hours <= PLATEAU_HOURS) return hours;
    const excess = hours - PLATEAU_HOURS;
    return PLATEAU_HOURS + PLATEAU_HOURS * Math.atan(excess / PLATEAU_HOURS);
}

/**
 * Returns the passive shells earned since `lastActiveAt`.
 * Uses the user's current `shellsPerMessage` as the hourly base rate.
 */
export function computePassiveShells(
    shellsPerMessage: BigNum,
    lastActiveAt: string,
    now: Date = new Date(),
): BigNum {
    const elapsedMs = now.getTime() - new Date(lastActiveAt).getTime();
    if (elapsedMs <= 0) return bn(0);
    const hours = elapsedMs / MS_PER_HOUR;
    const shellHours = computePassiveShellHours(hours);
    return bnFloor(bnMul(shellsPerMessage, shellHours));
}

/**
 * Computes and credits the passive shells earned since `lastActiveAt`, then
 * updates `lastActiveAt` to now. Safe to call when `lastActiveAt` is absent
 * (sets it and returns 0 — income starts accumulating from the next call).
 */
export function applyPassiveIncome(guildId: string, userId: string): BigNum {
    const user = getUserShellsData(guildId, userId);
    if (!user) return bn(0);

    const now = new Date();
    const nowIso = now.toISOString();

    if (!user.lastActiveAt) {
        setLastActiveAt(guildId, userId, nowIso);
        return bn(0);
    }

    const passiveAmount = computePassiveShells(bnFromJSON(user.shellsPerMessage), user.lastActiveAt, now);
    setLastActiveAt(guildId, userId, nowIso);

    if (bnGt(passiveAmount, bn(0))) {
        addUserShells(guildId, userId, passiveAmount);
    }

    return passiveAmount;
}
