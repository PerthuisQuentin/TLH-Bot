import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationCommandOptionType,
    ApplicationIntegrationType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { getOption, replyEmbed, replyText, requireGuild } from '../commons/utils.ts';
import {
    getGameInstance,
    updateGameInstance,
    flushGameInstances,
} from '../idle/game-instance-storage.ts';
import { ALL_UPGRADE_IDS, UPGRADE_REGISTRY } from '../idle/core/upgrades/upgrade-registry.ts';
import { SHOP_PAGE_NAMES } from '../idle/core/shop-pages.ts';
import { ResourceId, UpgradeId } from '../idle/core/types.ts';
import { formatResource } from '../idle/core/resources.ts';
import { bnGt, formatBigNum } from '../idle/core/big-number.ts';
import type { ReadonlyUpgrade } from '../idle/core/upgrades/base-upgrade.ts';
import type { BigNum } from '../idle/core/big-number.ts';

const PARAM_CONFIRM = 'confirmer';

const EMBED_COLOR = 0xf4776a;

/** Split by `resetOnPrestige`, so a new upgrade lands in the right column on its own. */
function upgradeLines(
    upgrades: Readonly<Record<UpgradeId, ReadonlyUpgrade>>,
    reset: boolean,
): string[] {
    return ALL_UPGRADE_IDS.filter((id) => upgrades[id].resetOnPrestige === reset).map((id) => {
        const upgrade = upgrades[id];
        return `${upgrade.emoji} ${upgrade.name} — niveau **${upgrade.level}**`;
    });
}

/** Says nothing at all while the polyps are at level 0, so a fresh player sees no dead line. */
function coralBonus(multiplier: BigNum): string {
    if (!bnGt(multiplier, 1)) return '';
    return `\n*Vos polypes multiplient ce gain par ×${formatBigNum(multiplier)}.*`;
}

/** Both refusals are embeds too, so the command looks the same whatever it answers. */
function replyRefusal(res: Response, title: string, description: string): void {
    replyEmbed(res, { title, description, color: EMBED_COLOR }, { ephemeral: true });
}

function replyNotEnough(res: Response, shellsMissing: string): void {
    replyRefusal(
        res,
        '🪸 Prestige',
        `Votre récolte de ce cycle ne suffit pas encore à faire grandir le récif. Il manque **${shellsMissing}** à votre record depuis le dernier prestige.`,
    );
}

/**
 * Says nothing about coral: to a locked player the currency does not exist yet. That is also
 * why the title carries the seedling's emoji rather than the 🪸 the other replies use.
 */
function replyLocked(res: Response): void {
    const seedling = UPGRADE_REGISTRY[UpgradeId.CORAL_SEEDLING];
    replyRefusal(
        res,
        `${seedling.emoji} Prestige`,
        `Vos loutres n'ont rien où déposer leur récolte. Procurez-vous ${seedling.emoji} **${seedling.displayName}** dans \`/shop page:${SHOP_PAGE_NAMES[seedling.shopPage]}\` pour ouvrir le récif.`,
    );
}

async function handlePreview(res: Response, guildId: string, userId: string): Promise<void> {
    const instance = await getGameInstance(guildId, userId);
    const preview = instance.previewPrestige();

    if (!preview.unlocked) {
        replyLocked(res);
        return;
    }
    if (!preview.canPrestige) {
        replyNotEnough(res, formatResource(preview.shellsMissing, ResourceId.SHELLS));
        return;
    }

    const kept = upgradeLines(instance.upgrades, false);
    const runPeak = formatResource(instance.stats.runMaxShells, ResourceId.SHELLS);

    replyEmbed(
        res,
        {
            title: '🪸 Prestige',
            description:
                `Vos loutres prennent leur retraite, et tout ce qu'elles ont ramassé depuis votre ` +
                `dernier prestige se dépose sur le récif pour l'agrandir.\n\n` +
                `Récolte de ce cycle : **${runPeak}** → **${formatResource(preview.coral, ResourceId.CORAL)}** de récif en plus.` +
                coralBonus(instance.coralMultiplier),
            color: EMBED_COLOR,
            fields: [
                {
                    name: 'Ce que vous perdez',
                    value: [
                        `Solde : ${formatResource(instance.resources[ResourceId.SHELLS], ResourceId.SHELLS)}`,
                        ...upgradeLines(instance.upgrades, true),
                        `*Le récif se nourrit du record du cycle, pas de ce solde : dépenser en boutique ne réduit pas votre corail.*`,
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: 'Ce que vous gardez',
                    value: [
                        `Record historique, rôles et série`,
                        `Corail : ${formatResource(instance.resources[ResourceId.CORAL], ResourceId.CORAL)}`,
                        ...kept,
                    ].join('\n'),
                    inline: false,
                },
            ],
            footer: { text: `Pour confirmer : /prestige ${PARAM_CONFIRM}:true` },
        },
        { ephemeral: true },
    );
}

async function handleConfirm(res: Response, guildId: string, userId: string): Promise<void> {
    // The whole trade happens inside the mutator: a shell gain landing mid-prestige cannot
    // slip between reading the run peak and wiping it.
    const outcome = await updateGameInstance(guildId, userId, (instance) => {
        const result = instance.prestige();
        if (!result) {
            return { status: 'refused' as const, preview: instance.previewPrestige() };
        }

        return {
            status: 'done' as const,
            coral: result.coral,
            prestigeCount: result.prestigeCount,
            coralBalance: instance.resources[ResourceId.CORAL],
            otters: instance.upgrades[UpgradeId.DIVING_OTTERS].level,
            income: instance.income[ResourceId.SHELLS],
        };
    });

    if (outcome.status === 'refused') {
        if (!outcome.preview.unlocked) replyLocked(res);
        else replyNotEnough(res, formatResource(outcome.preview.shellsMissing, ResourceId.SHELLS));
        return;
    }

    // The player is told the run is gone, so it must not ride the write delay.
    await flushGameInstances(guildId);

    replyEmbed(
        res,
        {
            title: `🪸 Prestige ${outcome.prestigeCount}`,
            description:
                `La récolte de vos loutres s'est déposée sur le récif, qui gagne ` +
                `**${formatResource(outcome.coral, ResourceId.CORAL)}**.\n` +
                `*À dépenser dans \`/shop page:Corail\` pour l'agrandir durablement.*`,
            color: EMBED_COLOR,
            fields: [
                {
                    name: 'Corail',
                    value: formatResource(outcome.coralBalance, ResourceId.CORAL),
                    inline: true,
                },
                { name: 'Loutres', value: `niveau ${outcome.otters}`, inline: true },
                {
                    name: 'Récolte',
                    value: `${formatBigNum(outcome.income)} 🐚/msg`,
                    inline: true,
                },
            ],
            footer: { text: 'Votre record historique et vos rôles sont intacts.' },
        },
        { ephemeral: true },
    );
}

async function handlePrestigeCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as {
        guild_id?: string;
        member?: { user?: { id: string } };
        user?: { id: string };
        data?: { options?: Array<{ name: string; value: unknown }> };
    };

    const { guild_id } = body;
    const userId = body.member?.user?.id ?? body.user?.id;

    if (!requireGuild(res, guild_id)) return;
    if (!userId) {
        replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
        return;
    }

    const confirmed = getOption<boolean>(body.data?.options, PARAM_CONFIRM) === true;

    // Both branches reply as their last statement, so reaching the catch means nothing was
    // sent yet and the error reply is always the only one.
    try {
        if (confirmed) await handleConfirm(res, guild_id, userId);
        else await handlePreview(res, guild_id, userId);
    } catch (error) {
        console.error('Error handling prestige command:', error);
        replyText(res, 'Une erreur est survenue pendant le prestige.', { ephemeral: true });
    }
}

export const prestigeCommand: Command = {
    definition: {
        name: 'prestige',
        description: 'Sacrifie vos loutres et votre récolte pour du corail.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
        options: [
            {
                name: PARAM_CONFIRM,
                description:
                    'Confirme le prestige. Sans cette option, affiche seulement un aperçu.',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            },
        ],
    },
    handler: handlePrestigeCommand,
};
