import { describe, it, expect } from 'vitest';
import {
    AvatarSource,
    avatarRefFrom,
    avatarUrl,
    decodeAvatarRef,
    encodeAvatarRef,
} from './avatars.ts';

const HASH = '0123456789abcdef0123456789abcdef';

describe('avatarRefFrom', () => {
    it('prefers the server avatar, then the account one, then the default', () => {
        expect(avatarRefFrom({ avatar: HASH }, { avatar: 'other' })).toEqual({
            source: AvatarSource.MEMBER,
            hash: HASH,
        });
        expect(avatarRefFrom({ avatar: null }, { avatar: HASH })).toEqual({
            source: AvatarSource.USER,
            hash: HASH,
        });
        expect(avatarRefFrom(undefined, undefined)).toEqual({ source: AvatarSource.DEFAULT });
    });
});

describe('encodeAvatarRef / decodeAvatarRef', () => {
    it('round-trips every source, animated hashes included', () => {
        for (const ref of [
            { source: AvatarSource.MEMBER, hash: HASH },
            { source: AvatarSource.USER, hash: `a_${HASH}` },
            { source: AvatarSource.DEFAULT },
        ]) {
            expect(decodeAvatarRef(encodeAvatarRef(ref))).toEqual(ref);
        }
    });

    it('falls back to the default on anything malformed', () => {
        for (const raw of [undefined, '', 'x' + HASH, 'u', 'unot-a-hash', `u${HASH}/../x`]) {
            expect(decodeAvatarRef(raw)).toEqual({ source: AvatarSource.DEFAULT });
        }
    });
});

describe('avatarUrl', () => {
    it('builds the server, account and default URLs', () => {
        expect(avatarUrl({ source: AvatarSource.MEMBER, hash: HASH }, '42', 'g1')).toBe(
            `https://cdn.discordapp.com/guilds/g1/users/42/avatars/${HASH}.png?size=128`,
        );
        expect(avatarUrl({ source: AvatarSource.USER, hash: HASH }, '42', 'g1')).toBe(
            `https://cdn.discordapp.com/avatars/42/${HASH}.png?size=128`,
        );
        // (id >> 22) % 6, as Discord picks it for accounts without an avatar.
        expect(avatarUrl({ source: AvatarSource.DEFAULT }, '177476464902537216', 'g1')).toBe(
            `https://cdn.discordapp.com/embed/avatars/${Number((177476464902537216n >> 22n) % 6n)}.png`,
        );
        expect(avatarUrl({ source: AvatarSource.DEFAULT }, 'not-a-snowflake', 'g1')).toBe(
            'https://cdn.discordapp.com/embed/avatars/0.png',
        );
    });
});
