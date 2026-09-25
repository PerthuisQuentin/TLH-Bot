import type { Request, Response } from 'express';
import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    ButtonStyle,
    ComponentType,
    InteractionContextType,
} from 'discord-api-types/v10';
import type { APIMessageTopLevelComponent } from 'discord-api-types/v10';
import type { Command } from './types.ts';
import { PRESTIGE_OPEN_ID } from './prestige.ts';
import { shopOpenId } from './shop.ts';
import { ShopPage, UpgradeId } from '../idle/core/types.ts';
import { getShellsProfile } from '../idle/shells-profile.ts';
import { flushGameInstances, updateGameInstance } from '../idle/game-instance-storage.ts';
import {
    actionRow,
    button,
    container,
    section,
    separator,
    shareFooter,
    text,
    thumbnail,
} from '../commons/components.ts';
import {
    componentCustomId,
    replyComponents,
    replyText,
    requireGuild,
    updateComponents,
} from '../commons/utils.ts';
import {
    avatarRefFrom,
    avatarUrl,
    decodeAvatarRef,
    encodeAvatarRef,
    type AvatarRef,
} from '../discord/avatars.ts';

const COMMAND_NAME = 'shells';

// Refresh and share carry the profile they act on, as `<action>:<userId>:<avatar ref>`: a
// click brings no avatar of its own. The select brings its pick, with the avatar resolved.
const ACTION_REFRESH = 'refresh';
const ACTION_SHARE = 'share';
const ACTION_VIEW = 'view';
// The Pieuvre intendante's switch, one action per state it sets, on the same target shape.
const ACTION_AUTO_ON = 'auto-on';
const ACTION_AUTO_OFF = 'auto-off';
const TARGETED_ACTIONS = [ACTION_REFRESH, ACTION_SHARE, ACTION_AUTO_ON, ACTION_AUTO_OFF];

const ACCENT_COLOR = 0xffd700;

type AvatarHolder = { avatar?: string | null };

type InteractionBody = {
    guild_id?: string;
    member?: AvatarHolder & { user?: { id: string } & AvatarHolder };
    user?: { id: string } & AvatarHolder;
    data?: {
        values?: string[];
        resolved?: {
            users?: Record<string, AvatarHolder>;
            members?: Record<string, AvatarHolder>;
        };
    };
};

type ProfileTarget = { userId: string; avatar: AvatarRef };

function callerIdOf(body: InteractionBody): string | undefined {
    return body.member?.user?.id ?? body.user?.id;
}

/** Discord resolves the user picked in the select; the caller comes with the request. */
function avatarOf(body: InteractionBody, userId: string): AvatarRef {
    const resolved = body.data?.resolved;
    if (resolved?.users?.[userId] || resolved?.members?.[userId]) {
        return avatarRefFrom(resolved.members?.[userId], resolved.users?.[userId]);
    }
    if (userId === callerIdOf(body)) {
        return avatarRefFrom(body.member, body.member?.user ?? body.user);
    }
    return avatarRefFrom(undefined, undefined);
}

function targetCustomId(action: string, target: ProfileTarget): string {
    return componentCustomId(
        COMMAND_NAME,
        `${action}:${target.userId}:${encodeAvatarRef(target.avatar)}`,
    );
}

/** Sets the player's own switch. False while they have nothing to automate yet. */
async function setAutomation(guildId: string, userId: string, enabled: boolean): Promise<boolean> {
    const applied = await updateGameInstance(guildId, userId, (instance) => {
        if (instance.upgrades[UpgradeId.STEWARD_OCTOPUS].level === 0) return false;
        instance.setAutoBuy(enabled);
        return true;
    });
    // The redrawn panel tells the player it changed, so it must not ride the write delay.
    if (applied) await flushGameInstances(guildId);
    return applied;
}

/**
 * Private, the panel closes with its controls; shared, it is a read-only snapshot naming who
 * posted it.
 */
async function shellsPanel(
    guildId: string,
    target: ProfileTarget,
    viewerId: string | undefined,
    sharedBy?: string,
): Promise<APIMessageTopLevelComponent[]> {
    const profile = await getShellsProfile(guildId, target.userId);
    const now = `<t:${Math.floor(Date.now() / 1000)}:R>`;
    const footerLine = profile.hasSpentBelowMax
        ? `Max historique : ${profile.maxShellsText} · mis à jour ${now}`
        : `Mis à jour ${now}`;

    const body = [
        section(
            thumbnail(avatarUrl(target.avatar, target.userId, guildId)),
            text(`## 🐚 Profil Coquillages\n<@${target.userId}>`),
        ),
        separator(),
        text(
            `### Rôles\nRang : ${profile.rankText}\nActuel : ${profile.currentRoleText}\nProchain : ${profile.nextRoleText}`,
        ),
        text(
            `### Coquillages\n${profile.balanceText}\nPar message : ${profile.incomePerMessageText}\nPar réaction : ${profile.incomePerReactionText}\n${profile.growthRingsText}${profile.automationText ? `\n${profile.automationText}` : ''}`,
        ),
        // Dropped entirely rather than left empty while the layer is locked: an empty
        // "Récif" heading announces the mechanic just as loudly as its contents would.
        ...(profile.coralUnlocked
            ? [
                  text(
                      `### Récif\nCorail : ${profile.coralText}\n${profile.prestigeText}\n${profile.nextPrestigeText}`,
                  ),
              ]
            : []),
        text(`### Upgrades\n${profile.upgradeLines.join('\n')}`),
        separator(),
        shareFooter(footerLine, {
            sharedBy,
            shareId: targetCustomId(ACTION_SHARE, target),
        }),
    ];

    if (sharedBy) return [container(ACCENT_COLOR, ...body)];

    const own = target.userId === viewerId;
    return [
        container(
            ACCENT_COLOR,
            ...body,
            actionRow(
                button('🔄 Rafraîchir', targetCustomId(ACTION_REFRESH, target)),
                // Shortcuts act on the clicker, so they only make sense on your own profile.
                ...(own
                    ? [
                          button('🏪 Boutique', shopOpenId(ShopPage.SHELLS), {
                              style: ButtonStyle.Primary,
                          }),
                      ]
                    : []),
                ...(own && profile.coralUnlocked
                    ? [button('🪸 Prestige', PRESTIGE_OPEN_ID, { style: ButtonStyle.Primary })]
                    : []),
                ...(own && profile.automationEnabled !== null
                    ? [
                          profile.automationEnabled
                              ? button(
                                    '🐙 Couper l’automatisation',
                                    targetCustomId(ACTION_AUTO_OFF, target),
                                )
                              : button(
                                    '🐙 Activer l’automatisation',
                                    targetCustomId(ACTION_AUTO_ON, target),
                                    { style: ButtonStyle.Success },
                                ),
                      ]
                    : []),
            ),
            actionRow({
                type: ComponentType.UserSelect,
                custom_id: componentCustomId(COMMAND_NAME, ACTION_VIEW),
                placeholder: '👤 Voir le profil de…',
            }),
        ),
    ];
}

async function handleShellsCommand(req: Request, res: Response): Promise<void> {
    try {
        const body = req.body as InteractionBody;
        const { guild_id } = body;
        const requesterId = callerIdOf(body);

        if (!requireGuild(res, guild_id)) return;
        if (!requesterId) {
            replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
            return;
        }

        // Always your own profile first: the select switches to anyone else from there.
        const target = { userId: requesterId, avatar: avatarOf(body, requesterId) };
        const panel = await shellsPanel(guild_id, target, requesterId);
        replyComponents(res, panel, { ephemeral: true, suppressMentions: true });
    } catch (error) {
        console.error('Error handling shells command:', error);
        replyText(res, 'Une erreur est survenue en récupérant le profil.', { ephemeral: true });
    }
}

/** Every click lands on a private panel: a shared one has no component left to click. */
async function handleShellsComponent(req: Request, res: Response, action: string): Promise<void> {
    const body = req.body as InteractionBody;
    const [kind, rawTarget, rawAvatar] = action.split(':');

    let target: ProfileTarget;
    if (TARGETED_ACTIONS.includes(kind) && rawTarget) {
        target = { userId: rawTarget, avatar: decodeAvatarRef(rawAvatar) };
    } else if (kind === ACTION_VIEW && body.data?.values?.[0]) {
        const userId = body.data.values[0];
        target = { userId, avatar: avatarOf(body, userId) };
    } else {
        console.error(`unknown shells action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    try {
        const { guild_id } = body;
        if (!requireGuild(res, guild_id)) return;
        const clickerId = callerIdOf(body);

        if (kind === ACTION_SHARE) {
            if (!clickerId) {
                replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
                return;
            }
            const panel = await shellsPanel(guild_id, target, clickerId, clickerId);
            replyComponents(res, panel, { suppressMentions: true });
            return;
        }

        if (kind === ACTION_AUTO_ON || kind === ACTION_AUTO_OFF) {
            // The button only shows on your own profile; a forged id cannot reach someone else's.
            if (clickerId !== target.userId) {
                replyText(res, 'Vous ne pouvez régler que votre propre automatisation.', {
                    ephemeral: true,
                });
                return;
            }
            // Worded without naming the Pieuvre: what lies behind the seedling stays hidden.
            if (!(await setAutomation(guild_id, clickerId, kind === ACTION_AUTO_ON))) {
                replyText(res, 'Vous n’avez encore rien à automatiser.', { ephemeral: true });
                return;
            }
        }

        const panel = await shellsPanel(guild_id, target, clickerId);
        updateComponents(res, panel, { suppressMentions: true });
    } catch (error) {
        console.error('Error handling shells click:', error);
        replyText(res, 'Une erreur est survenue en récupérant le profil.', { ephemeral: true });
    }
}

export const shellsCommand: Command = {
    definition: {
        name: COMMAND_NAME,
        description: 'Affiche votre profil Coquillages',
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
    },
    handler: handleShellsCommand,
    onComponent: handleShellsComponent,
};
