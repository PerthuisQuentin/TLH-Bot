import { describe, it, expect } from 'vitest';
import { computePassiveShells, passiveCreditedUntil } from './passive-income.ts';
import { bn } from './big-number.ts';

const BASE = new Date('2026-01-01T00:00:00.000Z');
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

function hoursLater(hours: number): Date {
    return new Date(BASE.getTime() + hours * MS_PER_HOUR);
}

describe('computePassiveShells', () => {
    it('returns 0 when now is at or before lastActiveAt', () => {
        expect(computePassiveShells(bn(10), BASE, BASE).toString()).toBe('0');
        expect(computePassiveShells(bn(10), BASE, hoursLater(-1)).toString()).toBe('0');
    });

    it('matches the closed-form integral at the documented checkpoints', () => {
        // shellHours(H) = H for H <= 24, so the full-rate window is linear.
        expect(computePassiveShells(bn(10), BASE, hoursLater(12)).toString()).toBe('120');
        expect(computePassiveShells(bn(10), BASE, hoursLater(24)).toString()).toBe('240');

        // Past 24h: shellHours(H) = 24 + 24*atan((H-24)/24), Lorentzian decay.
        expect(computePassiveShells(bn(10), BASE, hoursLater(48)).toString()).toBe('428');
        expect(computePassiveShells(bn(10), BASE, hoursLater(72)).toString()).toBe('505');
        expect(computePassiveShells(bn(10), BASE, hoursLater(168)).toString()).toBe('577');
    });

    it('approaches the 24 + 12*pi cap but never reaches it', () => {
        const nearCap = computePassiveShells(bn(10), BASE, hoursLater(1_000_000));
        expect(nearCap.toString()).toBe('616');
        expect(nearCap.lt(617)).toBe(true);
    });

    it('scales linearly with shellsPerMessage', () => {
        expect(computePassiveShells(bn(100), BASE, hoursLater(24)).toString()).toBe('2400');
        expect(computePassiveShells(bn(100), BASE, hoursLater(48)).toString()).toBe('4284');
    });

    it('is monotonically increasing with elapsed time', () => {
        const checkpoints = [1, 12, 24, 48, 72, 168, 500];
        const values = checkpoints.map((h) => computePassiveShells(bn(10), BASE, hoursLater(h)));

        for (let i = 1; i < values.length; i++) {
            expect(values[i].gt(values[i - 1])).toBe(true);
        }
    });
});

function minutesLater(minutes: number): Date {
    return new Date(BASE.getTime() + minutes * MS_PER_MINUTE);
}

describe('passiveCreditedUntil', () => {
    it('does not move when nothing was credited, so the fraction keeps accruing', () => {
        // Three minutes at 10/h is half a shell: the floor pays 0, and advancing the clock
        // here is what used to destroy every short interval.
        const now = minutesLater(3);
        expect(computePassiveShells(bn(10), BASE, now).toString()).toBe('0');
        expect(passiveCreditedUntil(bn(10), BASE, now, bn(0)).getTime()).toBe(BASE.getTime());
    });

    it('advances by exactly the time the credited shells bought', () => {
        const now = minutesLater(90);
        const earned = computePassiveShells(bn(10), BASE, now);

        expect(earned.toString()).toBe('15');
        expect(passiveCreditedUntil(bn(10), BASE, now, earned).getTime()).toBe(now.getTime());
    });

    it('leaves the unpaid remainder behind when the credit was floored', () => {
        // 70 min at 10/h is 11.67 shells: 11 are paid, the 4 minutes worth of the twelfth
        // are not, so the clock stops 4 minutes short of now.
        const now = minutesLater(70);
        const earned = computePassiveShells(bn(10), BASE, now);

        expect(earned.toString()).toBe('11');
        expect(passiveCreditedUntil(bn(10), BASE, now, earned).getTime()).toBe(
            minutesLater(66).getTime(),
        );
    });

    it('jumps to now past the plateau, where time and shells are not interchangeable', () => {
        // The rate is no longer constant there: rewinding by the unpaid fraction would
        // reprice those minutes at the full rate. Under a shell out of hundreds, dropped.
        const now = hoursLater(48);
        const earned = computePassiveShells(bn(10), BASE, now);

        expect(passiveCreditedUntil(bn(10), BASE, now, earned).getTime()).toBe(now.getTime());
    });

    it('pays the same over many short intervals as over one long one', () => {
        // The bug, stated directly: 60 one-minute steps used to credit 0 against the 10
        // shells of a single one-hour step.
        const income = bn(10);
        let cursor = BASE;
        let total = bn(0);

        for (let minute = 1; minute <= 60; minute++) {
            const now = minutesLater(minute);
            const earned = computePassiveShells(income, cursor, now);
            total = total.add(earned);
            cursor = passiveCreditedUntil(income, cursor, now, earned);
        }

        const oneShot = computePassiveShells(income, BASE, minutesLater(60));
        expect(oneShot.toString()).toBe('10');
        expect(total.toString()).toBe('10');
    });
});
