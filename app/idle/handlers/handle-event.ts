import type { DiscordEvent, PendingRoleChanges } from '../../discord/types.ts';
import type { BigNum } from '../core/big-number.ts';
import { bn, bnGt } from '../core/big-number.ts';
import { ChannelActivityType } from '../core/types.ts';
import { fileStore, AllowedFiles } from '../../storage/index.ts';
import { updateChannelHeat } from '../core/heat/channel-activity.ts';
import { memoryCache } from '../../commons/memory.ts';
import { updateGameInstance } from '../game-instance-storage.ts';
import { rollJackpot, JACKPOT_MULTIPLIER } from '../core/jackpot.ts';
import { computeRoleChanges, getShellsRolesConfig } from '../shells-roles.ts';

const DISCORD_EVENT_COOLDOWN = 5;

const MESSAGE_SHELLS_FRACTION = 1.0;
const REACTION_SHELLS_FRACTION = 0.1;

const GAIN_FRACTIONS: Record<ChannelActivityType, number> = {
    [ChannelActivityType.Message]: MESSAGE_SHELLS_FRACTION,
    [ChannelActivityType.Reaction]: REACTION_SHELLS_FRACTION,
};

// Gain only: being reacted to is not an activity of the author's, so no cooldown,
// streak, heat or passive income — leaving lastActiveAt untouched on purpose.
async function creditMessageAuthor(guildId: string, userId: string): Promise<void> {
    const amount = await updateGameInstance(guildId, userId, (instance) =>
        instance.applyShellsGain(GAIN_FRACTIONS[ChannelActivityType.Reaction]),
    );

    console.log(
        `[Shells] Reaction received | userId=${userId} | guildId=${guildId} | amount=${amount}`,
    );
}

type DiscordEventResult = {
    jackpot?: {
        amount: BigNum;
        multiplier: number;
    };
    pendingRoleChanges?: PendingRoleChanges;
};

export async function handleDiscordEvent(event: DiscordEvent): Promise<DiscordEventResult> {
    const result: DiscordEventResult = {};

    // Check if the channel is ignored
    const config = await fileStore.readJson(event.guildId, AllowedFiles.CONFIG);
    if ((config.noShellChannels ?? []).includes(event.channelId)) return result;

    // Update heat before the cooldown check so every event counts toward activity,
    // even when the user is on cooldown and won't earn shells this time.
    const heatMultiplier = updateChannelHeat(event.channelId, event.userId, event.activityType);

    // Cooldown protection
    const cacheKey = `${event.guildId}:${event.userId}:${event.activityType}`;
    if (memoryCache.has(cacheKey)) return result;
    memoryCache.set(cacheKey, true, DISCORD_EVENT_COOLDOWN);

    // Everything that touches the player runs inside this synchronous mutator.
    const outcome = await updateGameInstance(event.guildId, event.userId, (gameInstance) => {
        const passiveIncomeEarned = gameInstance.applyPassiveIncome();

        // No activityType guard on purpose: a single reaction keeps the streak alive.
        gameInstance.updateStreak();
        const streakMultiplier = gameInstance.streak.getMultiplier();
        const activityTypeMultiplier = GAIN_FRACTIONS[event.activityType];
        const finalMultiplier = heatMultiplier * streakMultiplier * activityTypeMultiplier;
        const shellsGained = gameInstance.applyShellsGain(finalMultiplier);

        // Jackpot — independent from other multipliers, messages only
        const jackpotGained =
            event.activityType === ChannelActivityType.Message && rollJackpot()
                ? gameInstance.applyShellsGain(JACKPOT_MULTIPLIER)
                : null;

        return {
            passiveIncomeEarned,
            finalMultiplier,
            shellsGained,
            jackpotGained,
            maxShells: gameInstance.stats.maxShells,
        };
    });

    if (bnGt(outcome.passiveIncomeEarned, bn(0))) {
        console.log(
            `[Shells] Passive | userId=${event.userId} | guildId=${event.guildId} | amount=${outcome.passiveIncomeEarned}`,
        );
    }

    console.log(
        `[Shells] Added | userId=${event.userId} | guildId=${event.guildId} | amount=${outcome.shellsGained} | multiplier=${outcome.finalMultiplier.toFixed(2)} | activityType=${event.activityType}`,
    );

    if (outcome.jackpotGained) {
        result.jackpot = { amount: outcome.jackpotGained, multiplier: JACKPOT_MULTIPLIER };
        console.log(
            `[Shells] Jackpot! | userId=${event.userId} | guildId=${event.guildId} | amount=${outcome.jackpotGained}`,
        );
    }

    // The reacted message's author earns a share too — behind the reactor's cooldown,
    // so reaction spam can't farm someone else's balance.
    if (
        event.activityType === ChannelActivityType.Reaction &&
        event.messageAuthorId &&
        event.messageAuthorId !== event.userId
    ) {
        await creditMessageAuthor(event.guildId, event.messageAuthorId);
    }

    const shellsRoles = await getShellsRolesConfig(event.guildId);
    result.pendingRoleChanges = computeRoleChanges(
        shellsRoles,
        outcome.maxShells,
        event.currentRoleIds,
    );

    return result;
}
