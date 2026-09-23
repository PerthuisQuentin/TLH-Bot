import { getAllGameInstances, getGameInstance } from './game-instance-storage.ts';
import { Leaderboard } from './leaderboard.ts';
import { getShellsRolesConfig, nextRoleAfter, roleForShells } from './shells-roles.ts';
import { bnCeil, bnFromJSON, bnMul, bnSub, formatBigNum } from './core/big-number.ts';
import { formatResource } from './core/resources.ts';
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
    growthRingsText: string;
    coralText: string;
    /**
     * Whether the player has opened the prestige layer. False means the three fields below
     * are empty strings and the coral upgrades are absent from both upgrade lists: a locked
     * player must not learn that coral exists from their own profile.
     */
    coralUnlocked: boolean;
    /** Prestiges performed, and the peak the current run has reached toward the next one. */
    prestigeText: string;
    /** What `/prestige` would pay right now, or what the run peak still misses. */
    nextPrestigeText: string;
    /** Levelled upgrades only, so a one-shot unlock does not sit in a list of levels. */
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
    const { maxShells, runMaxShells, prestigeCount } = instance.stats;
    const shellsPerMessage = instance.income[ResourceId.SHELLS];
    const { upgrades } = instance;
    const leaderboard = new Leaderboard(instances);
    const entry = leaderboard.getUserEntry(userId);

    const rankText = entry ? `#${entry.rank}` : 'Non classé';

    const coralUnlocked = instance.coralUnlocked;
    // Unlocked rather than visible: a bought one-shot stays, so the assistant can still tell
    // a member they own it.
    const visibleUpgradeIds = ALL_UPGRADE_IDS.filter((id) => instance.isUpgradeUnlocked(id));

    // A one-shot unlock is left out: its level is a yes/no, and a "Niv. 0 · Récif scellé"
    // line in a list whose column is levels reads as an upgrade the player is behind on.
    // `/shop` still sells it, and `upgradeShopLines` still prices it for the assistant.
    const upgradeLines = visibleUpgradeIds
        .filter((id) => upgrades[id].maxLevel > 1)
        .map((id) => {
            const upgrade = upgrades[id];
            return `${upgrade.emoji} **${upgrade.name}** — Niv. ${upgrade.level} · ${upgrade.formatGain()}`;
        });

    // Same figures `/shop` shows, one line per upgrade instead of an embed field —
    // getMaxBuyable can scan up to MAX_LEVELS_PER_PURCHASE per upgrade, not free enough
    // to pay on every /shells call when only the LLM tool reads it.
    const upgradeShopLines = includeShopPricing
        ? visibleUpgradeIds.map((id) => {
              const upgrade = upgrades[id];
              // A maxed upgrade still quotes a price `buyUpgrade` would refuse, and
              // `getMaxBuyable` caps at 0 levels, which the branch below would word as
              // "fonds insuffisants" — the assistant would then tell a member to save up
              // for something they already own, however large their balance.
              if (upgrade.isMaxed) {
                  return `${upgrade.emoji} ${upgrade.name} — déjà acquis, il n'y a plus rien à acheter dessus`;
              }

              const nextCost = bnCeil(upgrade.getCost());
              const { levels: maxBuyable, totalCost } = upgrade.getMaxBuyable(
                  instance.resources[upgrade.costResourceId],
              );
              const currency = upgrade.costResourceId;
              const buyableText =
                  maxBuyable > 0
                      ? `achetable dès maintenant : ${maxBuyable} niveau${maxBuyable > 1 ? 'x' : ''} pour ${formatResource(bnCeil(totalCost), currency)}`
                      : 'fonds insuffisants pour le prochain niveau';
              return `${upgrade.emoji} ${upgrade.name} — Niv. ${upgrade.level} (${upgrade.formatGain()}) · prochain niveau : ${formatResource(nextCost, currency)} → ${upgrade.computeFormatGain(upgrade.level + 1)} · ${buyableText}`;
          })
        : [];

    const currentRole = roleForShells(shellsRoles, maxShells);
    const nextRole = nextRoleAfter(shellsRoles, maxShells);

    const currentRoleText = currentRole ? `<@&${currentRole.roleId}>` : 'Aucun';
    const nextRoleText = nextRole
        ? `<@&${nextRole.roleId}> — encore **${formatBigNum(bnSub(bnFromJSON(nextRole.threshold), maxShells))} 🐚**`
        : '✨ Rang maximum atteint';

    const ringDays = instance.growthRings.days;
    const growthRingsText =
        ringDays === 0
            ? '🌀 Stries de croissance : aucune'
            : `🌀 Stries de croissance : ${ringDays} jour${ringDays > 1 ? 's' : ''} — ×${instance.growthRingsMultiplier.toFixed(2)}${instance.growthRingsCapped ? ' (plafond atteint)' : ''}`;

    const prestigePreview = instance.previewPrestige();
    const prestigeText = coralUnlocked
        ? `${prestigeCount === 0 ? 'Aucun prestige' : `Prestige ${prestigeCount}`} · record du cycle : ${formatResource(runMaxShells, ResourceId.SHELLS)}`
        : '';
    const nextPrestigeText = !coralUnlocked
        ? ''
        : prestigePreview.canPrestige
          ? `\`/prestige\` rapporterait **${formatResource(prestigePreview.coral, ResourceId.CORAL)}**`
          : `Encore ${formatResource(prestigePreview.shellsMissing, ResourceId.SHELLS)} de record sur ce cycle avant le premier 🪸`;

    return {
        rankText,
        currentRoleText,
        nextRoleText,
        balanceText: `${formatBigNum(currentShells)} 🐚`,
        maxShellsText: `${formatBigNum(maxShells)} 🐚`,
        hasSpentBelowMax: !maxShells.eq(currentShells),
        incomePerMessageText: `${formatBigNum(shellsPerMessage)} 🐚 (±10%)`,
        incomePerReactionText: `${formatBigNum(bnMul(shellsPerMessage, 0.1))} 🐚`,
        growthRingsText,
        coralUnlocked,
        coralText: coralUnlocked
            ? formatResource(instance.resources[ResourceId.CORAL], ResourceId.CORAL)
            : '',
        prestigeText,
        nextPrestigeText,
        upgradeLines,
        upgradeShopLines,
    };
}
