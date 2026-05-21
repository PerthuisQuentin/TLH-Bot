import {
    addUserShells,
    getShellsLeaderboard,
    getUserLeaderboardEntry,
    getUserShells,
    getPaginatedShellsLeaderboard,
    getShellsPerMessage,
} from './shells-storage.js';
import { updateMemberShellsRoles } from './shells-roles.js';
import { readJsonFile, AllowedFiles } from '../commons/files.js';
import { memoryCache } from '../commons/memory.js';
import { updateChannelHeat } from './channel-activity.js';
import { generateRolePromotionMessage } from '../gemini/ask-gemini.js';
import { formatDiscordJsMessage } from '../commons/messages.js';
import { bn, bnAdd, bnSub, bnMul, bnFloor, type BigNum } from '../commons/big-number.js';
import type { Message, GuildMember, TextChannel } from 'discord.js';
import type { RoleChanges } from './types.js';

const SHELLS_COOLDOWN = 5;

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
): Promise<{ newShells: BigNum; maxShells: BigNum; roleChanges: RoleChanges }> {
    try {
        const base = getShellsPerMessage(guildId, userId);
        const variance = bnFloor(bnMul(base, 0.1));
        const rangeSize = bnAdd(bnMul(variance, 2), 1);
        const offset = bnFloor(bnMul(rangeSize, Math.random()));
        const rolled = bnAdd(bnSub(base, variance), offset);
        const amount = bnFloor(bnMul(rolled, multiplier));

        const { newShells, maxShells } = addUserShells(
            guildId,
            userId,
            amount,
        );

        console.log(
            `[Shells] Added | userId=${userId} | guildId=${guildId} | amount=${amount} | multiplier=${multiplier.toFixed(2)} | total=${newShells} | maxShells=${maxShells}`,
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

export async function handleMessageShells(message: Message): Promise<void> {
    const config = await readJsonFile(message.guildId!, AllowedFiles.CONFIG);
    const noShellChannels = config.noShellChannels ?? [];
    if (noShellChannels.includes(message.channelId)) {
        return;
    }

    // Update heat before the cooldown check so every message counts toward activity,
    // even when the user is on cooldown and won't earn shells this time.
    const multiplier = updateChannelHeat(message.channelId, message.author.id);

    const cacheKey = `shells:${message.guildId}:${message.author.id}`;
    if (memoryCache.has(cacheKey)) {
        return;
    }

    const { roleChanges } = await addShells(
        message.author.id,
        message.guildId!,
        message.member,
        multiplier,
    );

    if (roleChanges.added && roleChanges.addedRoleName) {
        try {
            const conversationContext = formatDiscordJsMessage(message) ?? '';
            const promotionMessage = await generateRolePromotionMessage({
                guildId: message.guildId!,
                channelName:
                    ('name' in message.channel ? message.channel.name : null) ?? 'canal',
                conversationContext,
                userName: message.member?.displayName ?? message.author.username,
                roleName: roleChanges.addedRoleName,
            });
            await (message.channel as TextChannel).send(
                `<@${message.author.id}> ${promotionMessage}`,
            );
        } catch (error) {
            console.error(
                `[Bot] Error sending promotion | userId=${message.author.id}`,
                error,
            );
        }
    }

    memoryCache.set(cacheKey, true, SHELLS_COOLDOWN);
}
