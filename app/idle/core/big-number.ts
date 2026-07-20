import { Decimal } from 'decimal.js';

export type BigNum = Decimal;
export type BigNumSource = Decimal.Value;

// ─── Constructor ──────────────────────────────────────────────────────────────

export function bn(value: BigNumSource): BigNum {
    return new Decimal(value);
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

export function bnAdd(a: BigNumSource, b: BigNumSource): BigNum {
    return Decimal.add(a, b);
}

export function bnSub(a: BigNumSource, b: BigNumSource): BigNum {
    return Decimal.sub(a, b);
}

export function bnMul(a: BigNumSource, b: BigNumSource): BigNum {
    return Decimal.mul(a, b);
}

export function bnDiv(a: BigNumSource, b: BigNumSource): BigNum {
    return Decimal.div(a, b);
}

export function bnMax(a: BigNumSource, b: BigNumSource): BigNum {
    return Decimal.max(a, b);
}

export function bnFloor(a: BigNumSource): BigNum {
    return Decimal.floor(a);
}

export function bnCeil(a: BigNumSource): BigNum {
    return Decimal.ceil(a);
}

export function bnPow(base: BigNumSource, exp: BigNumSource): BigNum {
    return Decimal.pow(base, exp);
}

// ─── Comparisons ─────────────────────────────────────────────────────────────

export function bnGte(a: BigNumSource, b: BigNumSource): boolean {
    return bn(a).gte(b);
}

export function bnGt(a: BigNumSource, b: BigNumSource): boolean {
    return bn(a).gt(b);
}

export function bnLte(a: BigNumSource, b: BigNumSource): boolean {
    return bn(a).lte(b);
}

export function bnLt(a: BigNumSource, b: BigNumSource): boolean {
    return bn(a).lt(b);
}

/** Ordre naturel croissant : -1 si a < b, 0 si a == b, 1 si a > b. Utilisable directement dans Array.sort. */
export function bnCompare(a: BigNumSource, b: BigNumSource): -1 | 0 | 1 {
    const r = bn(a).comparedTo(b);
    return r < 0 ? -1 : r > 0 ? 1 : 0;
}

// ─── Serialisation JSON ───────────────────────────────────────────────────────

/**
 * Désérialise depuis JSON.
 * Accepte une string (format courant) ou un number natif (backward compat
 * avec les anciens fichiers JSON qui stockaient des entiers).
 */
export function bnFromJSON(value: number | string): BigNum {
    return new Decimal(value);
}

// ─── Affichage ────────────────────────────────────────────────────────────────

/**
 * Suffixes idle game, indexés par tier (tier 1 = K, tier 2 = M, …).
 * Tier 12+ → notation scientifique.
 *
 * Tier | Suffixe | Seuil
 *  1   |   K     | 10^3
 *  2   |   M     | 10^6
 *  3   |   B     | 10^9
 *  4   |   T     | 10^12
 *  5   |   Qa    | 10^15
 *  6   |   Qu    | 10^18
 *  7   |   Sx    | 10^21
 *  8   |   Sp    | 10^24
 *  9   |   Oc    | 10^27
 *  10  |   No    | 10^30
 *  11  |   De    | 10^33
 */
const SUFFIXES = ['K', 'M', 'B', 'T', 'Qa', 'Qu', 'Sx', 'Sp', 'Oc', 'No', 'De'] as const;

/**
 * Formate un grand nombre en notation idiomatique idle game.
 *
 * Exemples :
 *   999          → "999"
 *   1 234        → "1.23K"
 *   12 345       → "12.3K"
 *   123 456      → "123K"
 *   1 234 567    → "1.23M"
 *   1e36         → "1.00e+36"
 */
export function formatBigNum(n: BigNum): string {
    if (n.isZero()) return '0';

    const e = n.e; // floor(log10(|n|))

    // Nombre < 1 000 : afficher avec 2 décimales (3 chiffres significatifs)
    if (e < 3) {
        const decimals = Math.max(0, 2 - Math.max(0, e));
        return n.toFixed(decimals);
    }

    // Tier de suffixe : tier 1 = K (e 3–5), tier 2 = M (e 6–8), etc.
    const tierIndex = Math.floor(e / 3);

    // Au-delà de De (e ≥ 36) → notation scientifique
    if (tierIndex > SUFFIXES.length) {
        return n.toExponential(2);
    }

    const suffix = SUFFIXES[tierIndex - 1];

    // Diviser par 10^(tierIndex * 3) pour obtenir la valeur d'affichage
    // ex : 1 234 567 / 10^6 = 1.234567 → "1.23M"
    // ex : 12 345 678 / 10^6 = 12.345678 → "12.3M"
    // ex : 123 456 789 / 10^6 = 123.456789 → "123M"
    const remainder = e % 3; // 0, 1 ou 2
    const decimals = Math.max(0, 2 - remainder);
    const divisor = new Decimal(10).pow(tierIndex * 3);

    return `${n.div(divisor).toFixed(decimals)}${suffix}`;
}
