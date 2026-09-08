import { type BigNum, bn, bnAdd, bnMul, bnPow } from './big-number.ts';

export enum ModifierTrigger {
    AT_LEVEL = 'at-level',
    EVERY = 'every',
    RANGE = 'range',
}

export enum ModifierOperation {
    ADDITIVE = 'additive', // sums value × stacks
    MULTIPLICATIVE = 'multiplicative', // multiplies by value ^ stacks
    MULTIPLICATIVE_LINEAR = 'multiplicative-linear', // multiplies by value × stacks
}

export type Modifier = {
    operation: ModifierOperation;
    value: number;
} & (
    | { trigger: ModifierTrigger.AT_LEVEL; level: number }
    | { trigger: ModifierTrigger.EVERY; interval: number }
    | { trigger: ModifierTrigger.RANGE; from: number; to: number }
);

function modifierStacks(modifier: Modifier, level: number): number {
    switch (modifier.trigger) {
        case ModifierTrigger.AT_LEVEL:
            return level >= modifier.level ? 1 : 0;
        case ModifierTrigger.EVERY:
            return Math.floor(level / Math.max(1, modifier.interval));
        case ModifierTrigger.RANGE:
            return level >= modifier.from && level <= modifier.to ? 1 : 0;
    }
}

// result = additive sum × multiplicative product
export function computeValue(level: number, modifiers: Modifier[]): BigNum {
    let additiveSum = bn(0);
    let multiplicativeProduct = bn(1);
    for (const mod of modifiers) {
        const stacks = modifierStacks(mod, level);
        switch (mod.operation) {
            case ModifierOperation.ADDITIVE:
                additiveSum = bnAdd(additiveSum, bnMul(mod.value, stacks));
                break;
            case ModifierOperation.MULTIPLICATIVE:
                multiplicativeProduct = bnMul(multiplicativeProduct, bnPow(mod.value, stacks));
                break;
            // Unlike value^stacks, value × stacks is 0 before the first trigger and would
            // wipe the product, so an untriggered linear modifier stays neutral.
            case ModifierOperation.MULTIPLICATIVE_LINEAR:
                if (stacks > 0) {
                    multiplicativeProduct = bnMul(multiplicativeProduct, bnMul(mod.value, stacks));
                }
                break;
        }
    }
    return bnMul(additiveSum, multiplicativeProduct);
}
