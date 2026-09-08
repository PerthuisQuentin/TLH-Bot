import { describe, it, expect, afterEach } from 'vitest';
import { Collection, type Guild } from 'discord.js';
import { guildDisplayNameResolver } from './members.ts';
import { client } from './setup.ts';

afterEach(() => {
    client.guilds.cache.clear();
});

function fakeGuild(members: Record<string, string>): Guild {
    const memberCache = new Collection(
        Object.entries(members).map(([id, displayName]) => [id, { displayName }]),
    );
    return { members: { cache: memberCache } } as unknown as Guild;
}

describe('guildDisplayNameResolver', () => {
    it('returns the known name without consulting the guild cache', () => {
        const resolver = guildDisplayNameResolver('g-known', new Map([['u1', 'Known Name']]));

        expect(resolver('u1')).toBe('Known Name');
    });

    it('falls back to the guild member cache when the id is not in `known`', () => {
        client.guilds.cache.set('g1', fakeGuild({ u1: 'Guild Nickname' }));

        const resolver = guildDisplayNameResolver('g1');

        expect(resolver('u1')).toBe('Guild Nickname');
    });

    it('returns null when the guild itself is not in the client cache', () => {
        const resolver = guildDisplayNameResolver('g-unknown');

        expect(resolver('u1')).toBeNull();
    });

    it('returns null when the guild is cached but the member is not', () => {
        client.guilds.cache.set('g2', fakeGuild({}));

        const resolver = guildDisplayNameResolver('g2');

        expect(resolver('u1')).toBeNull();
    });

    it('defaults `known` to empty when omitted', () => {
        client.guilds.cache.set('g3', fakeGuild({ u1: 'From guild' }));

        const resolver = guildDisplayNameResolver('g3');

        expect(resolver('u1')).toBe('From guild');
    });
});
