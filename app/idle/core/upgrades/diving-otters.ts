import { UpgradeKind, UpgradeId, ResourceId } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { formatBigNum } from '../big-number.ts';
import { computeValue, ModifierTrigger, ModifierOperation } from '../maths.ts';
import type { BigNum } from '../big-number.ts';

export class DivingOttersUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.DIVING_OTTERS;
    static readonly kind = UpgradeKind.ADDITIVE;
    static readonly costResourceId = ResourceId.SHELLS;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Loutres plongeuses';
    static readonly emoji = '🦦';
    static readonly description =
        'Envoyez des loutres plonger pour ramasser des coquillages à votre place. Chaque loutre supplémentaire gonfle votre récolte.';

    computeCost(level: number): BigNum {
        return computeValue(level, [
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
        ]);
    }

    computeGain(level: number): BigNum {
        return computeValue(level, [
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
        ]);
    }

    computeFormatGain(level: number): string {
        return `+${formatBigNum(this.computeGain(level))} 🐚/msg`;
    }
}
