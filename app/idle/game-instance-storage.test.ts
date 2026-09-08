import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    getAllGameInstances,
    getGameInstance,
    flushGameInstances,
    updateGameInstance,
} from './game-instance-storage.ts';
import { ResourceId, UpgradeId } from './core/types.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-game-instance-storage-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

function gameInstanceFixture(userId: string, shells: string) {
    return {
        userId,
        resources: { shells },
        stats: { maxShells: shells },
        income: { shells: '10' },
        streak: { value: 3, lastDate: '2020-01-01' },
        lastActiveAt: new Date(0).toISOString(),
        upgrades: {},
    };
}

async function writeGameInstances(guildId: string, instances: unknown[]): Promise<void> {
    await writeFile(
        join(dir, `${guildId}-game-instances.json`),
        JSON.stringify(instances, null, 2),
    );
}

describe('getGameInstance', () => {
    // Type-level assertions, checked by `npx tsc --noEmit` (which covers the tests): the
    // returned copy is detached, so every one of these would change RAM and persist
    // nothing. Keeping them off the type is the only thing that makes that unwritable.
    it('exposes no mutator, since a mutation on the copy would be lost', async () => {
        const instance = await getGameInstance('g-detached', 'u1');

        expectTypeOf(instance).not.toHaveProperty('buyUpgrade');
        expectTypeOf(instance).not.toHaveProperty('updateStreak');
        expectTypeOf(instance).not.toHaveProperty('applyShellsGain');
        expectTypeOf(instance).not.toHaveProperty('applyPassiveIncome');
        expectTypeOf(instance).not.toHaveProperty('computeIncome');
        // The Streak behind the getter is a live object: Readonly stops at the property.
        expectTypeOf(instance.streak).not.toHaveProperty('update');
    });

    it('reads a player back without touching the stored values', async () => {
        const guildId = 'g-read';
        await writeGameInstances(guildId, [gameInstanceFixture('u1', '5000')]);

        const instance = await getGameInstance(guildId, 'u1');

        expect(instance.userId).toBe('u1');
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('5000');
        expect(instance.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(0);
        expect(instance.streak.toJson()).toEqual({ value: 3, lastDate: '2020-01-01' });
    });

    it('falls back to a fresh player when the guild has no file', async () => {
        const instance = await getGameInstance('g-empty', 'unknown');

        expect(instance.userId).toBe('unknown');
        expect(instance.resources[ResourceId.SHELLS].toString()).toBe('0');
    });
});

describe('updateGameInstance', () => {
    it('is the path that writes back, and returns what the mutator returned', async () => {
        const guildId = 'g-sanctioned';
        await writeGameInstances(guildId, [gameInstanceFixture('u1', '5000')]);

        const outcome = await updateGameInstance(guildId, 'u1', (instance) =>
            instance.buyUpgrade(UpgradeId.DIVING_OTTERS, 1),
        );
        expect(outcome).toMatchObject({ previousLevel: 0, newLevel: 1 });

        await flushGameInstances(guildId);
        const reloaded = await getGameInstance(guildId, 'u1');
        expect(reloaded.resources[ResourceId.SHELLS].toString()).toBe('4000');
        expect(reloaded.upgrades[UpgradeId.DIVING_OTTERS].level).toBe(1);
    });

    it('creates the player on first write rather than failing', async () => {
        const guildId = 'g-newcomer';

        await updateGameInstance(guildId, 'newcomer', (instance) => instance.updateStreak());
        await flushGameInstances(guildId);

        const [instance] = await getAllGameInstances(guildId);
        expect(instance.userId).toBe('newcomer');
        expect(instance.streak.currentValue).toBe(1);
    });
});
