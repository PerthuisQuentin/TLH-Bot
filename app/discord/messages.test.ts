import { describe, it, expect } from 'vitest';
import { parseApiMessages } from './messages.ts';

function apiMessage(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        type: 0,
        content: 'hello',
        author: { id: 'u1', username: 'alice' },
        timestamp: '2026-08-10T12:00:00.000Z',
        ...overrides,
    };
}

describe('parseApiMessages', () => {
    it('parses a regular (type 0) message', () => {
        const [parsed] = parseApiMessages([apiMessage({ content: 'hi there' })]);
        expect(parsed).toMatchObject({ userId: 'u1', content: 'hi there', handle: 'alice' });
    });

    it('reads the content of a type-20 application-command reply from its first component', () => {
        const [parsed] = parseApiMessages([
            apiMessage({
                type: 20,
                content: undefined,
                components: [{ content: 'from component' }],
            }),
        ]);
        expect(parsed?.content).toBe('from component');
    });

    it('drops messages of any other type — they carry no readable content', () => {
        const result = parseApiMessages([apiMessage({ type: 7, content: 'ignored' })]);
        expect(result).toEqual([]);
    });

    it('drops messages whose extracted content is empty', () => {
        const result = parseApiMessages([apiMessage({ content: '' })]);
        expect(result).toEqual([]);
    });

    it('replaces a mentioned user id with @username when the mention is known', () => {
        const [parsed] = parseApiMessages([
            apiMessage({
                content: 'hey <@42>, look at this',
                mentions: [{ id: '42', username: 'bob' }],
            }),
        ]);
        expect(parsed?.content).toBe('hey @bob, look at this');
    });

    it('leaves an unresolved mention id untouched', () => {
        const [parsed] = parseApiMessages([apiMessage({ content: 'hey <@999>', mentions: [] })]);
        expect(parsed?.content).toBe('hey <@999>');
    });

    it('resolves displayName: resolver first, then global_name, then username', () => {
        const [byUsername] = parseApiMessages([
            apiMessage({ author: { id: 'u1', username: 'alice' } }),
        ]);
        expect(byUsername?.displayName).toBe('alice');

        const [byGlobalName] = parseApiMessages([
            apiMessage({ author: { id: 'u1', username: 'alice', global_name: 'Alice G.' } }),
        ]);
        expect(byGlobalName?.displayName).toBe('Alice G.');

        const [byResolver] = parseApiMessages(
            [apiMessage({ author: { id: 'u1', username: 'alice', global_name: 'Alice G.' } })],
            (userId) => (userId === 'u1' ? 'Server Nickname' : null),
        );
        expect(byResolver?.displayName).toBe('Server Nickname');

        const [resolverMisses] = parseApiMessages(
            [apiMessage({ author: { id: 'u1', username: 'alice', global_name: 'Alice G.' } })],
            () => null,
        );
        expect(resolverMisses?.displayName).toBe('Alice G.');
    });

    it('defaults isBot to false when the field is absent', () => {
        const [humanMsg] = parseApiMessages([apiMessage({})]);
        expect(humanMsg?.isBot).toBe(false);

        const [botMsg] = parseApiMessages([
            apiMessage({ author: { id: 'u2', username: 'botty', bot: true } }),
        ]);
        expect(botMsg?.isBot).toBe(true);
    });

    it('reverses newest-first input into chronological order, after dropping empty ones', () => {
        const newest = apiMessage({ author: { id: 'a' }, content: 'newest' });
        const empty = apiMessage({ author: { id: 'b' }, content: '' });
        const oldest = apiMessage({ author: { id: 'c' }, content: 'oldest' });

        const result = parseApiMessages([newest, empty, oldest]);

        expect(result.map((m) => m.content)).toEqual(['oldest', 'newest']);
    });

    it('returns an empty array for no messages', () => {
        expect(parseApiMessages([])).toEqual([]);
    });
});
