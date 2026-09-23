/**
 * The prestige conversion: what a run is worth in coral, and what a run that is worth
 * nothing yet still owes. Calibrated with `scripts/simulate-prestige.ts`, reasoned about in
 * `docs/prestige-design.md`.
 */

import {
    bn,
    bnCeil,
    bnDiv,
    bnFloor,
    bnGte,
    bnMax,
    bnMul,
    bnPow,
    bnSub,
    type BigNum,
} from '../big-number.ts';

// coral = floor(coralMultiplier * (runMaxShells / CORAL_DIVISOR) ^ CORAL_EXPONENT)
//
// The divisor is the price of the first coral, so it is what gates the first prestige, which
// no upgrade can have touched yet: 10^6 shells of run peak, around a month in for an active
// member, whatever the exponent is. A round number on purpose — it is the one figure a player
// reads off a refusal, and `coralSeedling` prices itself at a tenth of it. It sets when the layer opens and almost nothing
// else — it is a constant factor on every payout, so it shifts the whole schedule earlier
// without changing how fast prestiges follow one another.
export const CORAL_DIVISOR = 1e6;

// Sub-linear on purpose. A run held twice as long pays far less than twice the coral, so
// waiting has diminishing returns and the player is pushed to reset. It is also the knob that
// sets how fast the layer decelerates: the lower it is, the more peak each further coral costs
// and the longer runs get. Unlike the divisor, this one is the pace knob: it decides how many
// prestiges fit in a year. Calibrated at 0.26 against both coral upgrades, see
// docs/prestige-design.md.
export const CORAL_EXPONENT = 0.26;

export type PrestigePreview = {
    /** Coral the prestige would pay. Floored, so it is 0 until the first threshold. */
    coral: BigNum;
    /** False below one coral: there is nothing to trade, so the reset is refused. */
    canPrestige: boolean;
    /** Run peak still missing for the first coral. 0 once `canPrestige` is true. */
    shellsMissing: BigNum;
};

/** Floored once, at the end: the multiplier belongs inside the rounding, not after it. */
export function coralForRun(runMaxShells: BigNum, coralMultiplier: BigNum): BigNum {
    if (runMaxShells.lte(0)) return bn(0);
    return bnFloor(
        bnMul(coralMultiplier, bnPow(bnDiv(runMaxShells, CORAL_DIVISOR), CORAL_EXPONENT)),
    );
}

/**
 * The formula solved for its input: the run peak that pays exactly `coral`. Exact at one
 * coral, which is the only value `previewPrestige` asks for. Higher up, the floor and the
 * 20 significant digits behind BigNum can leave the answer a unit of coral short, so this
 * is a display figure and never a gate.
 */
export function runPeakForCoral(coral: BigNum, coralMultiplier: BigNum): BigNum {
    return bnMul(CORAL_DIVISOR, bnPow(bnDiv(coral, coralMultiplier), bnDiv(1, CORAL_EXPONENT)));
}

/**
 * Everything `/prestige` needs to state the trade. `coralMultiplier` comes from the coral
 * upgrades and is required rather than defaulted: a caller that forgets it would quote a
 * payout the prestige then beats, so the type system asks the question. Reach it through
 * `GameInstance.previewPrestige`, which already knows the answer.
 */
export function previewPrestige(runMaxShells: BigNum, coralMultiplier: BigNum): PrestigePreview {
    const coral = coralForRun(runMaxShells, coralMultiplier);
    const canPrestige = bnGte(coral, 1);

    return {
        coral,
        canPrestige,
        shellsMissing: canPrestige
            ? bn(0)
            : bnMax(0, bnSub(bnCeil(runPeakForCoral(bn(1), coralMultiplier)), runMaxShells)),
    };
}
