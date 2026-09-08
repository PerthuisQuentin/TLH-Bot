import { bn, bnDiv, bnFloor, bnLte, bnMul, type BigNum } from './big-number.ts';

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
    lastActiveAt: Date,
    now: Date = new Date(),
): BigNum {
    const elapsedMs = now.getTime() - lastActiveAt.getTime();
    if (elapsedMs <= 0) return bn(0);
    const hours = elapsedMs / MS_PER_HOUR;
    const shellHours = computePassiveShellHours(hours);
    return bnFloor(bnMul(shellsPerMessage, shellHours));
}

/**
 * The instant `credited` shells have actually paid for. Advancing `lastActiveAt` to `now`
 * instead drops whatever fraction of a shell the floor cut off — with a 10/h income that
 * fraction is a whole 6-minute window, so a member chatting every couple of minutes would
 * be paid nothing at all.
 */
export function passiveCreditedUntil(
    shellsPerMessage: BigNum,
    lastActiveAt: Date,
    now: Date,
    credited: BigNum,
): Date {
    // Nothing was paid for, so nothing is owed less. Also covers a zero rate, hence no
    // division by zero below.
    if (bnLte(credited, 0)) return lastActiveAt;

    const hours = (now.getTime() - lastActiveAt.getTime()) / MS_PER_HOUR;

    // Past the plateau the rate is no longer constant, so time and shells stop being
    // interchangeable: rewinding by the unpaid fraction would move those minutes back to
    // the head of the curve, where they would be paid again at the full rate instead of
    // the decayed one. It is under one shell out of a payout worth hundreds — dropped.
    if (hours > PLATEAU_HOURS) return now;

    // shellHours(H) = H here, so the integral is the identity and the time bought is exact.
    const hoursPaid = bnDiv(credited, shellsPerMessage).toNumber();
    return new Date(lastActiveAt.getTime() + hoursPaid * MS_PER_HOUR);
}
