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
import { ACTION_NAVIGATE, NavPanel, navigationRow } from './navigation.ts';
import { ResourceId, UpgradeId } from '../idle/core/types.ts';
import { formatResource } from '../idle/core/resources.ts';
import { UPGRADE_REGISTRY } from '../idle/core/upgrades/upgrade-registry.ts';
import { formatBigNum } from '../idle/core/big-number.ts';
import { getShellsProfile, type ShellsProfile } from '../idle/shells-profile.ts';
import { oceanLevelsFor } from '../idle/ocean-levels.ts';
import { renderOceanCached } from '../ocean/cache.ts';
import {
    flushGameInstances,
    getGameInstance,
    updateGameInstance,
} from '../idle/game-instance-storage.ts';
import {
    actionRow,
    button,
    container,
    mediaGallery,
    section,
    separator,
    shareFooter,
    text,
    thumbnail,
} from '../commons/components.ts';
import {
    NO_MENTIONS,
    componentCustomId,
    editInteractionComponents,
    replyDeferred,
    replyDeferredUpdate,
    replyText,
    requireGuild,
    updateInteractionResponseOrLog,
    type DiscordFile,
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
// click brings no avatar of its own. The select brings its pick, with the avatar resolved,
// and navigation always lands on the clicker's own profile.
const ACTION_REFRESH = 'refresh';
const ACTION_SHARE = 'share';
const ACTION_VIEW = 'view';
// The Pieuvre intendante's switch, one action per state it sets, on the same target shape.
const ACTION_AUTO_ON = 'auto-on';
const ACTION_AUTO_OFF = 'auto-off';
const TARGETED_ACTIONS = [ACTION_REFRESH, ACTION_SHARE, ACTION_AUTO_ON, ACTION_AUTO_OFF];

const ACCENT_COLOR = 0xffd700;

const OCEAN_FILE = 'ocean.png';

const ERROR_TEXT = 'Une erreur est survenue en récupérant le profil.';

type AvatarHolder = { avatar?: string | null };

type InteractionBody = {
    token: string;
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

/** Who the member is beside their avatar: role and rank, the next role, the automation switch. */
function bannerLines(userId: string, profile: ShellsProfile): string[] {
    const octopus = UPGRADE_REGISTRY[UpgradeId.STEWARD_OCTOPUS];
    return [
        `<@${userId}> · ${profile.currentRoleText} · ${profile.rankText}`,
        `Prochain rôle : ${profile.nextRoleText}`,
        // Null until the Pieuvre's first level: nothing to announce yet.
        ...(profile.automationEnabled === null
            ? []
            : [
                  `${octopus.emoji} Automatisation : **${profile.automationEnabled ? 'activée' : 'désactivée'}**`,
              ]),
    ];
}

/**
 * One `<emoji> **amount** Name - detail` line per resource. The coral lines are dropped
 * entirely while the layer is locked, so nothing announces the mechanic.
 */
function resourceLines(profile: ShellsProfile): string[] {
    const days = profile.growthRingDays;
    const preview = profile.prestigePreview;
    return [
        `🐚 **${formatBigNum(profile.shells)}** Coquillages - ${formatBigNum(profile.shellsPerMessage)}/msg`,
        `🌀 **${days}** Strie${days > 1 ? 's' : ''} - ×${profile.growthRingsMultiplier.toFixed(2)}${profile.growthRingsCapped ? ' (plafond atteint)' : ''}`,
        ...(profile.coralUnlocked
            ? [
                  `🪸 **${formatBigNum(profile.coral)}** Corail - ${
                      preview.canPrestige
                          ? `+${formatBigNum(preview.coral)} au prestige`
                          : `prestige dans ${formatResource(preview.shellsMissing, ResourceId.SHELLS)}`
                  }`,
                  profile.prestigeText,
              ]
            : []),
    ];
}

/** The components, and the ocean picture they name. */
type Panel = { components: APIMessageTopLevelComponent[]; files: DiscordFile[] };

/**
 * Private, the panel closes with its controls; shared, it is a read-only snapshot naming who
 * posted it.
 */
async function shellsPanel(
    guildId: string,
    target: ProfileTarget,
    viewerId: string | undefined,
    sharedBy?: string,
): Promise<Panel> {
    const profile = await getShellsProfile(guildId, target.userId);
    const ocean = renderOceanCached(oceanLevelsFor(await getGameInstance(guildId, target.userId)));
    const files = [{ name: OCEAN_FILE, data: ocean, contentType: 'image/png' }];
    const now = `<t:${Math.floor(Date.now() / 1000)}:R>`;
    const footerLine = profile.hasSpentBelowMax
        ? `Max historique : ${profile.maxShellsText} · mis à jour ${now}`
        : `Mis à jour ${now}`;

    const body = [
        section(
            thumbnail(avatarUrl(target.avatar, target.userId, guildId)),
            text(`## 🐚 Profil Coquillages\n${bannerLines(target.userId, profile).join('\n')}`),
        ),
        mediaGallery({
            url: `attachment://${OCEAN_FILE}`,
            description: 'L’océan du profil : loutres, kelp, corail et coquillages',
        }),
        separator(),
        text(`### Ressources\n${resourceLines(profile).join('\n')}`),
        text(`### Upgrades\n${profile.upgradeLines.join('\n')}`),
        separator(),
        shareFooter(footerLine, {
            sharedBy,
            shareId: targetCustomId(ACTION_SHARE, target),
        }),
    ];

    if (sharedBy) return { components: [container(ACCENT_COLOR, ...body)], files };

    const own = target.userId === viewerId;
    // The navigation acts on whoever clicks, so its prestige button follows their reef.
    const viewerCoralUnlocked =
        own || !viewerId
            ? profile.coralUnlocked
            : (await getGameInstance(guildId, viewerId)).coralUnlocked;
    const components = [
        container(
            ACCENT_COLOR,
            ...body,
            ...(own && profile.automationEnabled !== null
                ? [
                      actionRow(
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
                      ),
                  ]
                : []),
            actionRow({
                type: ComponentType.UserSelect,
                custom_id: componentCustomId(COMMAND_NAME, ACTION_VIEW),
                placeholder: '👤 Voir le profil de…',
            }),
            // On someone else's profile, 👤 Profil stays live: it leads back to your own.
            navigationRow(targetCustomId(ACTION_REFRESH, target), {
                current: own ? NavPanel.PROFILE : null,
                coralUnlocked: viewerCoralUnlocked,
            }),
        ),
    ];
    return { components, files };
}

/** Past the deferral: the panel goes out as an edit, the only way to carry the picture. */
async function sendPanel(token: string, panel: Panel): Promise<void> {
    await editInteractionComponents(token, panel.components, {
        files: panel.files,
        allowedMentions: NO_MENTIONS,
    });
}

async function handleShellsCommand(req: Request, res: Response): Promise<void> {
    const body = req.body as InteractionBody;
    const { guild_id } = body;
    const requesterId = callerIdOf(body);

    if (!requireGuild(res, guild_id)) return;
    if (!requesterId) {
        replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
        return;
    }

    replyDeferred(res, { ephemeral: true });
    try {
        // Always your own profile first: the select switches to anyone else from there.
        const target = { userId: requesterId, avatar: avatarOf(body, requesterId) };
        await sendPanel(body.token, await shellsPanel(guild_id, target, requesterId));
    } catch (error) {
        console.error('Error handling shells command:', error);
        await updateInteractionResponseOrLog(body.token, ERROR_TEXT);
    }
}

/** Every click lands on a private panel: a shared one has no component left to click. */
async function handleShellsComponent(req: Request, res: Response, action: string): Promise<void> {
    const body = req.body as InteractionBody;
    const [kind, rawTarget, rawAvatar] = action.split(':');
    const callerId = callerIdOf(body);

    let target: ProfileTarget;
    if (TARGETED_ACTIONS.includes(kind) && rawTarget) {
        target = { userId: rawTarget, avatar: decodeAvatarRef(rawAvatar) };
    } else if (action === ACTION_NAVIGATE && callerId) {
        target = { userId: callerId, avatar: avatarOf(body, callerId) };
    } else if (kind === ACTION_VIEW && body.data?.values?.[0]) {
        const userId = body.data.values[0];
        target = { userId, avatar: avatarOf(body, userId) };
    } else {
        console.error(`unknown shells action: ${action}`);
        res.status(400).json({ error: 'unknown component' });
        return;
    }

    const { guild_id } = body;
    if (!requireGuild(res, guild_id)) return;

    // Everything that answers with a plain refusal happens before the deferral, while a
    // reply of its own is still possible.
    try {
        if (kind === ACTION_SHARE && !callerId) {
            replyText(res, 'Impossible de déterminer l’utilisateur.', { ephemeral: true });
            return;
        }

        if (kind === ACTION_AUTO_ON || kind === ACTION_AUTO_OFF) {
            // The button only shows on your own profile; a forged id cannot reach someone else's.
            if (callerId !== target.userId) {
                replyText(res, 'Vous ne pouvez régler que votre propre automatisation.', {
                    ephemeral: true,
                });
                return;
            }
            // Worded without naming the Pieuvre: what lies behind the seedling stays hidden.
            if (!(await setAutomation(guild_id, callerId, kind === ACTION_AUTO_ON))) {
                replyText(res, 'Vous n’avez encore rien à automatiser.', { ephemeral: true });
                return;
            }
        }
    } catch (error) {
        console.error('Error handling shells click:', error);
        replyText(res, ERROR_TEXT, { ephemeral: true });
        return;
    }

    // Share posts a new public message; every other click redraws the one clicked.
    const sharedBy = kind === ACTION_SHARE ? callerId : undefined;
    if (sharedBy) replyDeferred(res);
    else replyDeferredUpdate(res);
    try {
        await sendPanel(body.token, await shellsPanel(guild_id, target, callerId, sharedBy));
    } catch (error) {
        console.error('Error handling shells click:', error);
        await updateInteractionResponseOrLog(body.token, ERROR_TEXT);
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
