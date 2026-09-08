import { UpgradeKind, UpgradeId, ResourceId } from '../types.ts';
import { BaseUpgrade } from './base-upgrade.ts';
import { formatBigNum } from '../big-number.ts';
import { computeValue, ModifierTrigger, ModifierOperation } from '../maths.ts';
import type { BigNum } from '../big-number.ts';

export class HydrodynamicFlippersUpgrade extends BaseUpgrade {
    static readonly id = UpgradeId.HYDRODYNAMIC_FLIPPERS;
    static readonly kind = UpgradeKind.MULTIPLICATIVE;
    static readonly costResourceId = ResourceId.SHELLS;
    static readonly gainResourceId = ResourceId.SHELLS;
    static readonly displayName = 'Nageoires hydrodynamiques';
    static readonly emoji = '🐟';
    static readonly description =
        "Des nageoires perfectionnées décuplent l'efficacité de vos loutres. Chaque amélioration amplifie la récolte de toute la troupe.";

    computeCost(level: number): BigNum {
        return computeValue(level, [
            {
                trigger: ModifierTrigger.AT_LEVEL,
                level: 0,
                operation: ModifierOperation.ADDITIVE,
                value: 15000,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 1,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 1.3,
            },
            {
                trigger: ModifierTrigger.EVERY,
                interval: 10,
                operation: ModifierOperation.MULTIPLICATIVE,
                value: 5,
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
                value: 1.15,
            },
        ]);
    }

    computeFormatGain(level: number): string {
        return `×${formatBigNum(this.computeGain(level))}`;
    }
}
