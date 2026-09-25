import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    ButtonStyle,
    InteractionContextType,
} from 'discord-api-types/v10';
import type {
    APIButtonComponentWithCustomId,
    APIComponentInContainer,
    APIMessageTopLevelComponent,
} from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { shopOpenId } from './shop.ts';
import {
    actionRow,
    button,
    container,
    separator,
    shareFooter,
    text,
} from '../commons/components.ts';
import {
    componentCustomId,
    replyComponents,
    replyText,
    requireGuild,
    updateComponents,
} from '../commons/utils.ts';
import {
    getGameInstance,
    updateGameInstance,
    flushGameInstances,
} from '../idle/game-instance-storage.ts';
import { ALL_UPGRADE_IDS, UPGRADE_REGISTRY } from '../idle/core/upgrades/upgrade-registry.ts';
import { SHOP_PAGE_NAMES } from '../idle/core/shop-pages.ts';
import { ResourceId, ShopPage, UpgradeId } from '../idle/core/types.ts';
import { formatResource } from '../idle/core/resources.ts';
import { bnFromJSON, bnGt, formatBigNum } from '../idle/core/big-number.ts';
import type { ReadonlyGameInstance } from '../idle/core/game-instance.ts';
import type { BigNum } from '../idle/core/big-number.ts';

const COMMAND_NAME = 'prestige';
const ACTION_CONFIRM = 'confirm';
const ACTION_CANCEL = 'cancel';
const ACTION_SHARE = 'share';
const ACTION_OPEN = 'open';

/** Opens the preview in a new private message, for a shortcut drawn by another command. */
export const PRESTIGE_OPEN_ID = componentCustomId(COMMAND_NAME, ACTION_OPEN);

const ACCENT_COLOR = 0xf4776a;

type Panel = APIMessageTopLevelComponent[];

/**
 * Split by `resetOnPrestige`, so a new upgrade lands in the right column on its own. Locked
 * ones are left out: a "niveau 0" line would announce an upgrade the player cannot see yet.
 */
function upgradeLines(instance: ReadonlyGameInstance, reset: boolean): string[] {
    return ALL_UPGRADE_IDS.filter(
        (id) => instance.isUpgradeUnlocked(id) && instance.upgrades[id].resetOnPrestige === reset,
    ).map((id) => {
        const upgrade = instance.upgrades[id];
        return `${upgrade.emoji} ${upgrade.name} — niveau **${upgrade.level}**`;
    });
}

/** Says nothing at all while the polyps are at level 0, so a fresh player sees no dead line. */
function coralBonus(multiplier: BigNum): string {
    if (!bnGt(multiplier, 1)) return '';
    return `\n*Vos polypes multiplient ce gain par ×${formatBigNum(multiplier)}.*`;
}

// ─── Panels ──────────────────────────────────────────────────────────────────

/** Every reply is one container in the same colour, so the command reads the same whatever it answers. */
function panel(...components: APIComponentInContainer[]): Panel {
    return [container(ACCENT_COLOR, ...components)];
}

function notEnoughPanel(shellsMissing: string): Panel {
    return panel(
        text(
            `## 🪸 Prestige\nVotre récolte de ce cycle ne suffit pas encore à faire grandir le récif. Il manque **${shellsMissing}** à votre record depuis le dernier prestige.`,
        ),
    );
}

/**
 * Says nothing about coral: to a locked player the currency does not exist yet. That is also
 * why the title carries the seedling's emoji rather than the 🪸 the other replies use.
 */
function shopButton(page: ShopPage): APIButtonComponentWithCustomId {
    return button('🏪 Boutique', shopOpenId(page), { style: ButtonStyle.Primary });
}

function lockedPanel(): Panel {
    const seedling = UPGRADE_REGISTRY[UpgradeId.CORAL_SEEDLING];
    return panel(
        text(
            `## ${seedling.emoji} Prestige\nVos loutres n'ont rien où déposer leur récolte. Procurez-vous ${seedling.emoji} **${seedling.displayName}** dans la boutique, rayon ${SHOP_PAGE_NAMES[seedling.shopPage]}, pour ouvrir le récif.`,
        ),
        actionRow(shopButton(seedling.shopPage)),
    );
}

function previewPanel(instance: ReadonlyGameInstance): Panel {
    const preview = instance.previewPrestige();

    if (!preview.unlocked) return lockedPanel();
    if (!preview.canPrestige) {
        return notEnoughPanel(formatResource(preview.shellsMissing, ResourceId.SHELLS));
    }

    const runPeak = formatResource(instance.stats.runMaxShells, ResourceId.SHELLS);
    const lost = [
        `Solde : ${formatResource(instance.resources[ResourceId.SHELLS], ResourceId.SHELLS)}`,
        ...upgradeLines(instance, true),
        `*Le récif se nourrit du record du cycle, pas de ce solde : dépenser en boutique ne réduit pas votre corail.*`,
    ];
    const kept = [
        `Record historique, rôles et stries de croissance`,
        `Corail : ${formatResource(instance.resources[ResourceId.CORAL], ResourceId.CORAL)}`,
        ...upgradeLines(instance, false),
    ];

    return panel(
        text(
            `## 🪸 Prestige\n` +
                `Vos loutres prennent leur retraite, et tout ce qu'elles ont ramassé depuis votre ` +
                `dernier prestige se dépose sur le récif pour l'agrandir.\n\n` +
                `Récolte de ce cycle : **${runPeak}** → **${formatResource(preview.coral, ResourceId.CORAL)}** de récif en plus.` +
                coralBonus(instance.coralMultiplier),
        ),
        separator(),
        text(`### Ce que vous perdez\n${lost.join('\n')}`),
        text(`### Ce que vous gardez\n${kept.join('\n')}`),
        actionRow(
            button('Confirmer le prestige', componentCustomId(COMMAND_NAME, ACTION_CONFIRM), {
                style: ButtonStyle.Danger,
            }),
            button('Annuler', componentCustomId(COMMAND_NAME, ACTION_CANCEL)),
        ),
    );
}

function cancelledPanel(): Panel {
    return panel(text(`## 🪸 Prestige\nPrestige annulé, rien n'a changé.`));
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function confirmPrestige(guildId: string, userId: string): Promise<Panel> {
    // The whole trade happens inside the mutator: a shell gain landing mid-prestige cannot
    // slip between reading the run peak and wiping it. It also re-checks everything, so a
    // click on a stale preview, or a second click, is judged on the state at click time.
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
        if (!outcome.preview.unlocked) return lockedPanel();
        return notEnoughPanel(formatResource(outcome.preview.shellsMissing, ResourceId.SHELLS));
    }

    // The player is told the run is gone, so it must not ride the write delay.
    await flushGameInstances(guildId);

    const summary = [
        `Corail : **${formatResource(outcome.coralBalance, ResourceId.CORAL)}**`,
        `Loutres : niveau **${outcome.otters}**`,
        `Récolte : **${formatBigNum(outcome.income)} 🐚/msg**`,
    ].join(' · ');

    return panel(
        text(
            `## 🪸 Prestige ${outcome.prestigeCount}\n` +
                `La récolte de vos loutres s'est déposée sur le récif, qui gagne ` +
                `**${formatResource(outcome.coral, ResourceId.CORAL)}**.\n` +
                `*À dépenser dans la boutique, rayon ${SHOP_PAGE_NAMES[ShopPage.CORAL]}, pour l'agrandir durablement.*`,
        ),
        separator(),
        text(summary),
        shareFooter('Votre record historique et vos rôles sont intacts.', {
            shareId: componentCustomId(
                COMMAND_NAME,
                `${ACTION_SHARE}:${outcome.prestigeCount}:${outcome.coral.toString()}`,
            ),
        }),
        actionRow(shopButton(ShopPage.CORAL)),
    );
}

/**
 * The public side of a prestige: the event, not the private summary, so balances stay
 * private. Read back from the button, since the trade it reports is already done.
 */
function sharedPanel(sharerId: string, prestigeCount: number, coral: BigNum): Panel {
    return panel(
        text(
            `🪸 <@${sharerId}> a fait son **Prestige ${prestigeCount}** : le récif gagne **${formatResource(coral, ResourceId.CORAL)}**.`,
        ),
    );
}

type Caller = { guildId: string; userId: string };

/** Slash command and button click carry the caller the same way. */
function resolveCaller(req: Request, res: Response): Caller | undefined {
    const body = req.body as {
        guild_id?: string;
        member?: { user?: { id: string } };
        user?: { id: string };
    };

    const { guild_id } = body;
    const userId = body.member?.user?.id ?? body.user?.id;

    if (!requireGuild(res, guild_id)) return undefined;
    if (!userId) {
        replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
        return undefined;
    }
    return { guildId: guild_id, userId };
}

async function handlePrestigeCommand(req: Request, res: Response): Promise<void> {
    await openPreview(req, res);
}

/** The command and the shortcut alike post the preview as a new private message. */
async function openPreview(req: Request, res: Response): Promise<void> {
    const caller = resolveCaller(req, res);
    if (!caller) return;

    // The reply is the last statement, so reaching the catch means nothing was sent yet.
    try {
        const instance = await getGameInstance(caller.guildId, caller.userId);
        replyComponents(res, previewPanel(instance), { ephemeral: true });
    } catch (error) {
        console.error('Error handling prestige command:', error);
        replyText(res, 'Une erreur est survenue pendant le prestige.', { ephemeral: true });
    }
}

/**
 * No owner check: the preview is ephemeral, and a click acts on the clicker's own instance
 * anyway, never on the one the preview was drawn for.
 */
async function handlePrestigeComponent(req: Request, res: Response, action: string): Promise<void> {
    const [kind, rawCount, rawCoral] = action.split(':');
    if (kind === ACTION_SHARE) {
        handleShare(req, res, rawCount, rawCoral);
        return;
    }
    if (action === ACTION_OPEN) {
        await openPreview(req, res);
        return;
    }
    if (action !== ACTION_CONFIRM && action !== ACTION_CANCEL) {
        console.error(`unknown prestige action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    const caller = resolveCaller(req, res);
    if (!caller) return;

    // Same contract as the command: the update is the last statement.
    try {
        if (action === ACTION_CANCEL) updateComponents(res, cancelledPanel());
        else updateComponents(res, await confirmPrestige(caller.guildId, caller.userId));
    } catch (error) {
        console.error('Error handling prestige confirmation:', error);
        replyText(res, 'Une erreur est survenue pendant le prestige.', { ephemeral: true });
    }
}

function handleShare(req: Request, res: Response, rawCount: string, rawCoral: string): void {
    const prestigeCount = Number(rawCount);
    let coral: BigNum | undefined;
    try {
        coral = bnFromJSON(rawCoral);
    } catch {
        coral = undefined;
    }
    if (!Number.isInteger(prestigeCount) || prestigeCount < 1 || !coral || !coral.isFinite()) {
        console.error(`malformed prestige share: ${rawCount}:${rawCoral}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    const caller = resolveCaller(req, res);
    if (!caller) return;

    replyComponents(res, sharedPanel(caller.userId, prestigeCount, coral), {
        suppressMentions: true,
    });
}

export const prestigeCommand: Command = {
    definition: {
        name: COMMAND_NAME,
        description: 'Sacrifie vos loutres et votre récolte pour du corail.',
        type: ApplicationCommandType.ChatInput,
        integration_types: [ApplicationIntegrationType.GuildInstall],
        contexts: [InteractionContextType.Guild],
    },
    handler: handlePrestigeCommand,
    onComponent: handlePrestigeComponent,
};
