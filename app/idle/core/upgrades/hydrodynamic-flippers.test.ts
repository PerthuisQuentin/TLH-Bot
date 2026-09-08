import { describe, it, expect } from 'vitest';
import { HydrodynamicFlippersUpgrade } from './hydrodynamic-flippers.ts';

describe('HydrodynamicFlippersUpgrade', () => {
    it('computeCost: base cost, then x1.3/level and an extra x5 every 10 levels', () => {
        expect(new HydrodynamicFlippersUpgrade(0).computeCost(0).toString()).toBe('15000');
        expect(new HydrodynamicFlippersUpgrade(0).computeCost(1).toString()).toBe('19500');
        expect(new HydrodynamicFlippersUpgrade(0).computeCost(10).toString()).toBe(
            '1033938.6888675',
        );
    });

    it('computeGain: x1.15 multiplicative per level, +1 base', () => {
        expect(new HydrodynamicFlippersUpgrade(0).computeGain(0).toString()).toBe('1');
        expect(new HydrodynamicFlippersUpgrade(0).computeGain(1).toString()).toBe('1.15');
        expect(new HydrodynamicFlippersUpgrade(0).computeGain(10).toString()).toBe(
            '4.0455577357079101563',
        );
    });

    it('computeFormatGain renders the multiplier with formatBigNum', () => {
        expect(new HydrodynamicFlippersUpgrade(0).computeFormatGain(0)).toBe('×1.00');
        expect(new HydrodynamicFlippersUpgrade(0).computeFormatGain(1)).toBe('×1.15');
        expect(new HydrodynamicFlippersUpgrade(0).computeFormatGain(10)).toBe('×4.05');
    });
});
