export const JACKPOT_CHANCE = 1 / 1000;
export const JACKPOT_MULTIPLIER = 1000;

/** Returns true if a jackpot is triggered this roll. */
export function rollJackpot(): boolean {
    return Math.random() < JACKPOT_CHANCE;
}
