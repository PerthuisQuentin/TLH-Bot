import { describe, it, expect } from 'vitest';
import { bn, formatBigNum } from './big-number.ts';

describe('formatBigNum', () => {
    it('formats zero as a bare "0"', () => {
        expect(formatBigNum(bn(0))).toBe('0');
    });

    it('shows numbers under 1000 with just enough decimals for 3 significant digits', () => {
        expect(formatBigNum(bn(999))).toBe('999');
        expect(formatBigNum(bn(71.415))).toBe('71.4');
        expect(formatBigNum(bn(0.5))).toBe('0.50');
    });

    it('switches to the K suffix exactly at 1000, not just below it', () => {
        expect(formatBigNum(bn(999))).toBe('999');
        expect(formatBigNum(bn(1000))).toBe('1.00K');
    });

    it('picks the decimal count from the exponent within a suffix tier', () => {
        expect(formatBigNum(bn(1234))).toBe('1.23K');
        expect(formatBigNum(bn(12345))).toBe('12.3K');
        expect(formatBigNum(bn(123456))).toBe('123K');
        expect(formatBigNum(bn(1234567))).toBe('1.23M');
    });

    it('falls back to scientific notation past the largest suffix (De)', () => {
        expect(formatBigNum(bn('1e36'))).toBe('1.00e+36');
    });
});
