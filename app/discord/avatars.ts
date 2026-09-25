// Avatar URLs for interaction payloads. A click carries no avatar, so the panel that draws the
// button packs a compact reference into its custom_id: one letter for the source, then the hash.

const CDN = 'https://cdn.discordapp.com';
const HASH_PATTERN = /^(a_)?[0-9a-f]{32}$/;

export enum AvatarSource {
    /** The member's server-specific avatar, which Discord shows over the account one. */
    MEMBER = 'm',
    USER = 'u',
    DEFAULT = 'd',
}

export type AvatarRef = { source: AvatarSource; hash?: string };

type AvatarHolder = { avatar?: string | null } | undefined;

export function avatarRefFrom(member: AvatarHolder, user: AvatarHolder): AvatarRef {
    if (member?.avatar) return { source: AvatarSource.MEMBER, hash: member.avatar };
    if (user?.avatar) return { source: AvatarSource.USER, hash: user.avatar };
    return { source: AvatarSource.DEFAULT };
}

export function encodeAvatarRef(ref: AvatarRef): string {
    return `${ref.source}${ref.hash ?? ''}`;
}

/** Anything unexpected falls back to the default avatar rather than into a URL. */
export function decodeAvatarRef(raw: string | undefined): AvatarRef {
    const source = raw?.charAt(0);
    const hash = raw?.slice(1) ?? '';
    if (
        (source === AvatarSource.MEMBER || source === AvatarSource.USER) &&
        HASH_PATTERN.test(hash)
    ) {
        return { source, hash };
    }
    return { source: AvatarSource.DEFAULT };
}

/** Discord's own pick for an account without an avatar: one of six, from the snowflake. */
function defaultAvatarIndex(userId: string): number {
    try {
        return Number((BigInt(userId) >> 22n) % 6n);
    } catch {
        return 0;
    }
}

export function avatarUrl(ref: AvatarRef, userId: string, guildId: string): string {
    if (ref.source === AvatarSource.MEMBER && ref.hash) {
        return `${CDN}/guilds/${guildId}/users/${userId}/avatars/${ref.hash}.png?size=128`;
    }
    if (ref.source === AvatarSource.USER && ref.hash) {
        return `${CDN}/avatars/${userId}/${ref.hash}.png?size=128`;
    }
    return `${CDN}/embed/avatars/${defaultAvatarIndex(userId)}.png`;
}
