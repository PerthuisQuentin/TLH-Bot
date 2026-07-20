import { describe, it, expect } from 'vitest';
import { computeValue, ModifierTrigger, ModifierOperation, type Modifier } from './maths.ts';

describe('computeValue — triggers', () => {
    it('AT_LEVEL contributes nothing below the level, then stays triggered from it on', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 5,
                operation: ModifierOperation.ADDITIVE,
                value: 10,
            },
        ];

        expect(computeValue(4, modifiers).toString()).toBe('0');
        expect(computeValue(5, modifiers).toString()).toBe('10');
        expect(computeValue(100, modifiers).toString()).toBe('10');
    });

    it('EVERY scales stacks by floor(level / interval)', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.EVERY,
                interval: 5,
                operation: ModifierOperation.ADDITIVE,
                value: 2,
            },
        ];

        expect(computeValue(0, modifiers).toString()).toBe('0');
        expect(computeValue(4, modifiers).toString()).toBe('0');
        expect(computeValue(5, modifiers).toString()).toBe('2');
        expect(computeValue(12, modifiers).toString()).toBe('4');
    });

    it('EVERY clamps a zero interval to 1, rather than dividing by zero', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.EVERY,
                interval: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 3,
            },
        ];

        expect(computeValue(7, modifiers).toString()).toBe('21');
    });

    it('RANGE triggers only inside [from, to], inclusive on both ends', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.RANGE,
                from: 3,
                to: 6,
                operation: ModifierOperation.ADDITIVE,
                value: 5,
            },
        ];

        expect(computeValue(2, modifiers).toString()).toBe('0');
        expect(computeValue(3, modifiers).toString()).toBe('5');
        expect(computeValue(6, modifiers).toString()).toBe('5');
        expect(computeValue(7, modifiers).toString()).toBe('0');
    });
});

describe('computeValue — operations', () => {
    it('ADDITIVE sums value * stacks across every additive modifier', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 100,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
        ];

        expect(computeValue(3, modifiers).toString()).toBe('103');
    });

    it('MULTIPLICATIVE multiplies value^stacks, neutral (1) before it first triggers', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 1.5,
            },
        ];

        // stacks = 0 at level 0 -> 1.5^0 = 1, product stays neutral
        expect(computeValue(0, modifiers).toString()).toBe('1');
        // stacks = 2 at level 2 -> 1.5^2 = 2.25
        expect(computeValue(2, modifiers).toString()).toBe('2.25');
    });

    it('multiple MULTIPLICATIVE modifiers multiply together', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 1.2,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
        ];

        // 1.2^10 * 2^1 = 6.1917364224 * 2
        expect(computeValue(10, modifiers).toString()).toBe('12.3834728448');
    });

    it('MULTIPLICATIVE_LINEAR stays neutral before it first triggers, rather than zeroing the product', () => {
        const modifiers: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE_LINEAR,
                value: 2,
            },
        ];

        // stacks = 0 below the first interval -- value * stacks would be 0 and wipe the
        // product, so this must stay neutral (1) instead.
        expect(computeValue(5, modifiers).toString()).toBe('1');
        // stacks = 1 at level 10 -> value * stacks = 2
        expect(computeValue(10, modifiers).toString()).toBe('2');
        // stacks = 2 at level 20 -> value * stacks = 4
        expect(computeValue(20, modifiers).toString()).toBe('4');
    });
});

describe('computeValue — composition', () => {
    it('returns 0 for an empty modifier list', () => {
        expect(computeValue(5, []).toString()).toBe('0');
    });

    it('matches the diving otters gain curve (EVERY/ADDITIVE + EVERY/MULTIPLICATIVE_LINEAR)', () => {
        const gain: Modifier[] = [
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.ADDITIVE,
                value: 1,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE_LINEAR,
                value: 2,
            },
        ];

        expect(computeValue(9, gain).toString()).toBe('9');
        expect(computeValue(10, gain).toString()).toBe('20');
        expect(computeValue(20, gain).toString()).toBe('80');
    });

    it('matches the diving otters cost curve (AT_LEVEL/ADDITIVE + two EVERY/MULTIPLICATIVE)', () => {
        const cost: Modifier[] = [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 1000,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 1.2,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
        ];

        expect(computeValue(0, cost).toString()).toBe('1000');
        expect(computeValue(10, cost).toString()).toBe('12383.4728448');
    });
});
