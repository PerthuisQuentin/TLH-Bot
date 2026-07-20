import { UpgradeKind, UpgradeId, ResourceId } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { formatBigNum } from '../big-number.ts';
import { computeValue, ModifierTrigger, ModifierOperation } from '../maths.ts';
import type { BigNum } from '../big-number.ts';

export class HarvestBagsUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.HARVEST_BAGS;
    static readonly kind = UpgradeKind.MULTIPLICATIVE;
    static readonly costResourceId = ResourceId.SHELLS;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Sacs de récolte XXL';
    static readonly emoji = '🎒';
    static readonly description =
        'Des sacs plus grands permettent à vos loutres de rapporter bien plus à chaque plongée. Chaque amélioration augmente la récolte de +50%.';

    computeCost(level: number): BigNum {
        return computeValue(level, [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 100000,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 2,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 10,
            },
        ]);
    }

    computeGain(level: number): BigNum {
        return computeValue(level, [
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
        ]);
    }

    computeFormatGain(level: number): string {
        return `×${formatBigNum(this.computeGain(level))}`;
    }
}
