import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { getShellsProfile } from '../idle/shells-profile.ts';
import {
    getOption,
    isPublicOption,
    replyEmbed,
    replyText,
    requireGuild,
} from '../commons/utils.ts';

const PARAM_USER = 'user';
const PARAM_PUBLIC = 'public';

async function handleShellsCommand(req: Request, res: Response): Promise<void> {
    try {
        const body = req.body as {
            guild_id?: string;
            data?: { options?: Array<{ name: string; value: unknown }> };
            member?: { user?: { id: string } };
            user?: { id: string };
        };
        const { guild_id, data } = body;
        const requesterId = body.member?.user?.id ?? body.user?.id;

        if (!requireGuild(res, guild_id)) return;

        const isPublic = isPublicOption(data?.options);
        const targetId = getOption<string>(data?.options, PARAM_USER) ?? requesterId;

        if (!targetId) {
            replyText(res, "Impossible de déterminer l'utilisateur cible.", { ephemeral: true });
            return;
        }

        const profile = await getShellsProfile(guild_id, targetId);

        const fields = [
            {
                name: 'Rôles',
                value: `Rang : ${profile.rankText}\nActuel : ${profile.currentRoleText}\nProchain : ${profile.nextRoleText}`,
                inline: false,
            },
            {
                name: 'Coquillages',
                value: `${profile.balanceText}\nPar message : ${profile.incomePerMessageText}\nPar réaction : ${profile.incomePerReactionText}\n${profile.streakText}`,
                inline: false,
            },
            // Dropped entirely rather than left empty while the layer is locked: an empty
            // "Récif" heading announces the mechanic just as loudly as its contents would.
            ...(profile.coralUnlocked
                ? [
                      {
                          name: 'Récif',
                          value: `Corail : ${profile.coralText}\n${profile.prestigeText}\n${profile.nextPrestigeText}`,
                          inline: false,
                      },
                  ]
                : []),
            { name: 'Upgrades', value: profile.upgradeLines.join('\n'), inline: false },
        ];

        replyEmbed(
            res,
            {
                title: '🐚 Profil Coquillages',
                description: `<@${targetId}>`,
                color: 0xffd700,
                fields,
                timestamp: new Date().toISOString(),
                ...(profile.hasSpentBelowMax && {
                    footer: { text: `Max historique : ${profile.maxShellsText}` },
                }),
            },
            { ephemeral: !isPublic, suppressMentions: true },
        );
    } catch (error) {
        console.error('Error handling rank command:', error);
        replyText(res, 'Une erreur est survenue en récupérant le profil.', { ephemeral: true });
    }
}

export const shellsCommand: Command = {
    definition: {
        name: 'shells',
        description: "Affiche le profil Coquillages d'un utilisateur",
        type: ApplicationCommandType.ChatInput,
        integration_types: [
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ],
        contexts: [
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ],
        options: [
            {
                type: ApplicationCommandOptionType.User,
                name: PARAM_USER,
                description: 'Utilisateur dont afficher le profil (vous par défaut)',
                required: false,
            },
            {
                type: ApplicationCommandOptionType.Boolean,
                name: PARAM_PUBLIC,
                description: 'Rendre la réponse visible par tous (par défaut : privée)',
                required: false,
            },
        ],
    },
    handler: handleShellsCommand,
};
