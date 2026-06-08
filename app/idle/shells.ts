import {
    addUserShells,
    getShellsLeaderboard,
    getUserLeaderboardEntry,
    getUserShells,
    getPaginatedShellsLeaderboard,
    getShellsPerMessage,
    updateUserStreak,
} from './shells-storage.js';
import { applyPassiveIncome } from './passive-income.js';
import { getStreakMultiplier } from './streak.js';
import { updateMemberShellsRoles } from './shells-roles.js';
import { readJsonFile, AllowedFiles } from '../commons/files.js';
import { memoryCache } from '../commons/memory.js';
import { updateChannelHeat, ChannelActivityType } from './channel-activity.js';
import { generateRolePromotionMessage } from '../gemini/ask-gemini.js';
import { formatDiscordJsMessage } from '../commons/messages.js';
import { bn, bnAdd, bnSub, bnMul, bnFloor, bnGt, type BigNum } from '../commons/big-number.js';
import type { Message, GuildMember, TextChannel, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import type { RoleChanges } from './types.js';

const SHELLS_COOLDOWN = 5;

const MESSAGE_SHELLS_FRACTION = 1.0;
const REACTION_SHELLS_FRACTION = 0.1;

const GAIN_FRACTIONS: Record<ChannelActivityType, number> = {
    [ChannelActivityType.Message]: MESSAGE_SHELLS_FRACTION,
    [ChannelActivityType.Reaction]: REACTION_SHELLS_FRACTION,
};

export {
    getShellsLeaderboard,
    getUserLeaderboardEntry,
    getUserShells,
    getPaginatedShellsLeaderboard,
};

export async function addShells(
    userId: string,
    guildId: string,
    member: GuildMember | null = null,
    multiplier = 1.0,
    activityType: ChannelActivityType = ChannelActivityType.Message,
): Promise<{ newShells: BigNum; maxShells: BigNum; roleChanges: RoleChanges }> {
    try {
        const base = getShellsPerMessage(guildId, userId);
        const variance = bnFloor(bnMul(base, 0.1));
        const rangeSize = bnAdd(bnMul(variance, 2), 1);
        const offset = bnFloor(bnMul(rangeSize, Math.random()));
        const rolled = bnAdd(bnSub(base, variance), offset);
        const rawAmount = bnFloor(bnMul(rolled, multiplier));
        const amount = bnFloor(bnMul(rawAmount, GAIN_FRACTIONS[activityType]));

        const { newShells, maxShells } = addUserShells(
            guildId,
            userId,
            amount,
        );

        console.log(
            `[Shells] Added | userId=${userId} | guildId=${guildId} | amount=${amount} | multiplier=${multiplier.toFixed(2)} | activityType=${activityType} | total=${newShells} | maxShells=${maxShells}`,
        );

        let roleChanges: RoleChanges = { added: null, addedRoleName: null, removed: [] };
        if (member) {
            try {
                roleChanges = await updateMemberShellsRoles(member, maxShells);
            } catch (roleError) {
                console.error(`[Shells] Error updating roles | userId=${userId}`, roleError);
            }
        }

        return { newShells, maxShells, roleChanges };
    } catch (error) {
        console.error(
            `[Shells] Error adding | userId=${userId} | guildId=${guildId}`,
            error,
        );
        return {
            newShells: bn(0),
            maxShells: bn(0),
            roleChanges: { added: null, addedRoleName: null, removed: [] },
        };
    }
}

type ShellsAwardContext = {
    guildId: string;
    channelId: string;
    channel: TextChannel;
    userId: string;
    displayName: string;
    member: GuildMember | null;
    cacheKey: string;
    activityType: ChannelActivityType;
    conversationContext: string;
};

async function awardShells(ctx: ShellsAwardContext): Promise<void> {
    const config = await readJsonFile(ctx.guildId, AllowedFiles.CONFIG);
    if ((config.noShellChannels ?? []).includes(ctx.channelId)) return;

    // Update heat before the cooldown check so every event counts toward activity,
    // even when the user is on cooldown and won't earn shells this time.
    const heatMultiplier = updateChannelHeat(ctx.channelId, ctx.userId, ctx.activityType);

    if (memoryCache.has(ctx.cacheKey)) return;

    const passiveAmount = applyPassiveIncome(ctx.guildId, ctx.userId);
    if (bnGt(passiveAmount, bn(0))) {
        console.log(
            `[Shells] Passive | userId=${ctx.userId} | guildId=${ctx.guildId} | amount=${passiveAmount}`,
        );
    }

    const streak = updateUserStreak(ctx.guildId, ctx.userId);
    const multiplier = heatMultiplier * getStreakMultiplier(streak);

    const { roleChanges } = await addShells(
        ctx.userId,
        ctx.guildId,
        ctx.member,
        multiplier,
        ctx.activityType,
    );

    if (roleChanges.added && roleChanges.addedRoleName) {
        try {
            const channelName = ('name' in ctx.channel ? ctx.channel.name : null) ?? 'canal';
            const promotionMessage = await generateRolePromotionMessage({
                guildId: ctx.guildId,
                channelName,
                conversationContext: ctx.conversationContext,
                userName: ctx.displayName,
                roleName: roleChanges.addedRoleName,
            });
            await ctx.channel.send(`<@${ctx.userId}> ${promotionMessage}`);
        } catch (error) {
            console.error(`[Bot] Error sending promotion | userId=${ctx.userId}`, error);
        }
    }

    memoryCache.set(ctx.cacheKey, true, SHELLS_COOLDOWN);
}

export async function handleMessageShells(message: Message): Promise<void> {
    await awardShells({
        guildId: message.guildId!,
        channelId: message.channelId,
        channel: message.channel as TextChannel,
        userId: message.author.id,
        displayName: message.member?.displayName ?? message.author.username,
        member: message.member,
        cacheKey: `shells:${message.guildId}:${message.author.id}`,
        activityType: ChannelActivityType.Message,
        conversationContext: formatDiscordJsMessage(message) ?? '',
    });
}

export async function handleReactionShells(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
): Promise<void> {
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
    } catch (error) {
        console.error('[Shells] Failed to fetch partial reaction/message', error);
        return;
    }

    const message = (reaction as MessageReaction).message;
    if (!message.guild || !message.guildId) return;

    let fullUser: User;
    try {
        fullUser = user.partial ? await user.fetch() : (user as User);
    } catch (error) {
        console.error('[Shells] Failed to fetch partial user', error);
        return;
    }
    if (fullUser.bot) return;

    // Block auto-reactions: if the reactor is the message author, nobody earns shells.
    // if (fullUser.id === message.author?.id) return;

    // Resolve the author early so we can fetch both members in parallel.
    const authorId = message.author?.id;
    const authorIsBot = message.author?.bot ?? false;

    let reactorMember: GuildMember | null = null;
    let authorMember: GuildMember | null = null;
    try {
        [reactorMember, authorMember] = await Promise.all([
            message.guild.members.fetch(fullUser.id),
            authorId && !authorIsBot ? message.guild.members.fetch(authorId) : Promise.resolve(null),
        ]);
    } catch (error) {
        console.error('[Shells] Failed to fetch reaction members', error);
    }

    const sharedAwardArgs = {
        guildId: message.guildId,
        channelId: message.channelId,
        channel: message.channel as TextChannel,
        activityType: ChannelActivityType.Reaction,
        conversationContext: '',
    };

    // Award shells to the reactor.
    await awardShells({
        ...sharedAwardArgs,
        userId: fullUser.id,
        displayName: reactorMember?.displayName ?? fullUser.username,
        member: reactorMember,
        cacheKey: `shells-reaction:${message.guildId}:${fullUser.id}`,
    });

    // Award shells to the message author (receiver of the reaction), unless they are a bot.
    if (!authorId || authorIsBot) return;

    await awardShells({
        ...sharedAwardArgs,
        userId: authorId,
        displayName: authorMember?.displayName ?? message.author!.username,
        member: authorMember,
        cacheKey: `shells-reaction:${message.guildId}:${authorId}`,
    });
}
