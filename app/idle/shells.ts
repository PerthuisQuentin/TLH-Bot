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
import { generateRolePromotionMessage } from '../gemini/ask-gemini.js';
import { formatDiscordJsMessage } from '../commons/messages.js';
import type { Message, GuildMember, TextChannel } from 'discord.js';
import type { RoleChanges } from './types.js';

const SHELLS_COOLDOWN = 10;

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
): Promise<{ newShells: number; maxShells: number; roleChanges: RoleChanges }> {
    try {
        const base = getShellsPerMessage(guildId, userId);
        const variance = Math.round(base * 0.1);
        const amount = base - variance + Math.floor(Math.random() * (2 * variance + 1));

        const { newShells, maxShells } = addUserShells(
            guildId,
            userId,
            amount,
        );

        console.log(
            `[Shells] Added | userId=${userId} | guildId=${guildId} | amount=${amount} | total=${newShells} | maxShells=${maxShells}`,
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
            newShells: 0,
            maxShells: 0,
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

    const cacheKey = `shells:${message.guildId}:${message.author.id}`;
    if (memoryCache.has(cacheKey)) {
        return;
    }

    const { roleChanges } = await addShells(
        message.author.id,
        message.guildId!,
        message.member,
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
