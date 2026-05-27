export const MAX_STREAK_DAYS = 7;

/**
 * Returns the streak multiplier for a given consecutive-day count.
 *
 * streak=1 (first day)  → ×1.00
 * streak=7+ (full week) → ×2.00
 *
 * Formula: 1 + min(streak − 1, 6) / 6
 */
export function getStreakMultiplier(streak: number): number {
    return 1 + Math.min(Math.max(streak - 1, 0), MAX_STREAK_DAYS - 1) / (MAX_STREAK_DAYS - 1);
}

/**
 * Pure function. Given the current streak state and today's date string
 * (YYYY-MM-DD), returns the updated streak and lastStreakDate.
 *
 * - Same day as lastStreakDate → no change (already counted today).
 * - Consecutive day (yesterday) → increment streak.
 * - Any other gap → reset to 1.
 */
export function computeNewStreak(
    currentStreak: number,
    lastStreakDate: string | undefined,
    today: string,
): { streak: number; lastStreakDate: string } {
    if (lastStreakDate === today) {
        return { streak: currentStreak, lastStreakDate: today };
    }

    const yesterday = getPreviousDateString(today);

    if (lastStreakDate === yesterday) {
        return { streak: currentStreak + 1, lastStreakDate: today };
    }

    return { streak: 1, lastStreakDate: today };
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for the day before the given date string.
 */
function getPreviousDateString(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Returns today's date as a YYYY-MM-DD string in the Europe/Paris timezone.
 */
export function getTodayString(): string {
    return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}
