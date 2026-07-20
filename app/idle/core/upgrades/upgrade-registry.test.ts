import { describe, it, expect } from 'vitest';
import { UPGRADE_REGISTRY, ALL_UPGRADE_IDS, ALL_UPGRADE_CLASSES } from './upgrade-registry.ts';
import { UpgradeId } from '../types.ts';

describe('UPGRADE_REGISTRY', () => {
    it('registers every class under the same id it reports on itself', () => {
        for (const id of ALL_UPGRADE_IDS) {
            expect(UPGRADE_REGISTRY[id].id).toBe(id);
        }
    });

    it('keeps ALL_UPGRADE_IDS and ALL_UPGRADE_CLASSES in sync with the UpgradeId enum', () => {
        expect(ALL_UPGRADE_IDS).toEqual(Object.values(UpgradeId));
        expect(ALL_UPGRADE_CLASSES).toHaveLength(ALL_UPGRADE_IDS.length);
    });
});
