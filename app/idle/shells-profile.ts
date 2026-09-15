import { getAllGameInstances, getGameInstance } from './game-instance-storage.ts';
import { Leaderboard } from './leaderboard.ts';
import { getShellsRolesConfig, nextRoleAfter, roleForShells } from './shells-roles.ts';
import { bnCeil, bnFromJSON, bnMul, bnSub, formatBigNum } from './core/big-number.ts';
import { ALL_UPGRADE_IDS } from './core/upgrades/upgrade-registry.ts';
import { ResourceId } from './core/types.ts';

/**
 * Every formatted piece of a member's Coquillages profile, shared by the `/shells`
 * embed and the `get_shells_profile` LLM tool so neither re-derives the other's text —
 * only how the pieces are laid out (embed fields vs. a flowing text block) differs.
 */
export type ShellsProfile = {
    rankText: string;
    currentRoleText: string;
    nextRoleText: string;
    balanceText: string;
    maxShellsText: string;
    hasSpentBelowMax: boolean;
    incomePerMessageText: string;
    incomePerReactionText: string;
    streakText: string;
    upgradeLines: string[];
    /** Same numbers as `/shop`: next level cost, and how many levels the current balance affords. */
    upgradeShopLines: string[];
};

export type GetShellsProfileOptions = {
    /** `/shop` buyability math nobody reads outside the LLM tool — skip it by default. */
    includeShopPricing?: boolean;
};

export async function getShellsProfile(
    guildId: string,
    userId: string,
    { includeShopPricing = false }: GetShellsProfileOptions = {},
): Promise<ShellsProfile> {
    const [instances, instance, shellsRoles] = await Promise.all([
        getAllGameInstances(guildId),
        getGameInstance(guildId, userId),
        getShellsRolesConfig(guildId),
    ]);

    const currentShells = instance.resources[ResourceId.SHELLS];
    const { maxShells } = instance.stats;
    const shellsPerMessage = instance.income[ResourceId.SHELLS];
    const { streak, upgrades } = instance;
    const leaderboard = new Leaderboard(instances);
    const entry = leaderboard.getUserEntry(userId);

    const rankText = entry ? `#${entry.rank}` : 'Non classé';

    const upgradeLines = ALL_UPGRADE_IDS.map((id) => {
        const upgrade = upgrades[id];
        return `${upgrade.emoji} **${upgrade.name}** — Niv. ${upgrade.level} · ${upgrade.formatGain()}`;
    });

    // Same figures `/shop` shows, one line per upgrade instead of an embed field —
    // getMaxBuyable can scan up to MAX_LEVELS_PER_PURCHASE per upgrade, not free enough
    // to pay on every /shells call when only the LLM tool reads it.
    const upgradeShopLines = includeShopPricing
        ? ALL_UPGRADE_IDS.map((id) => {
              const upgrade = upgrades[id];
              const nextCost = bnCeil(upgrade.getCost());
              const { levels: maxBuyable, totalCost } = upgrade.getMaxBuyable(
                  instance.resources[upgrade.costResourceId],
              );
              const buyableText =
                  maxBuyable > 0
                      ? `achetable dès maintenant : ${maxBuyable} niveau${maxBuyable > 1 ? 'x' : ''} pour ${formatBigNum(bnCeil(totalCost))} 🐚`
                      : 'fonds insuffisants pour le prochain niveau';
              return `${upgrade.emoji} ${upgrade.name} — Niv. ${upgrade.level} (${upgrade.formatGain()}) · prochain niveau : ${formatBigNum(nextCost)} 🐚 → ${upgrade.computeFormatGain(upgrade.level + 1)} · ${buyableText}`;
          })
        : [];

    const currentRole = roleForShells(shellsRoles, maxShells);
    const nextRole = nextRoleAfter(shellsRoles, maxShells);

    const currentRoleText = currentRole ? `<@&${currentRole.roleId}>` : 'Aucun';
    const nextRoleText = nextRole
        ? `<@&${nextRole.roleId}> — encore **${formatBigNum(bnSub(bnFromJSON(nextRole.threshold), maxShells))} 🐚**`
        : '✨ Rang maximum atteint';

    const streakDays = streak.currentValue;
    const streakText =
        streakDays === 0
            ? 'Streak : aucun 🔥'
            : `Streak : ${streakDays} jour${streakDays > 1 ? 's' : ''} 🔥 — ×${streak.getMultiplier().toFixed(2)}`;

    return {
        rankText,
        currentRoleText,
        nextRoleText,
        balanceText: `${formatBigNum(currentShells)} 🐚`,
        maxShellsText: `${formatBigNum(maxShells)} 🐚`,
        hasSpentBelowMax: !maxShells.eq(currentShells),
        incomePerMessageText: `${formatBigNum(shellsPerMessage)} 🐚 (±10%)`,
        incomePerReactionText: `${formatBigNum(bnMul(shellsPerMessage, 0.1))} 🐚`,
        streakText,
        upgradeLines,
        upgradeShopLines,
    };
}
