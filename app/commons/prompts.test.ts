import { describe, it, expect } from 'vitest';
import { formatConversation, createNaturalChatInstruction } from './prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
    return {
        userId: 'u1',
        displayName: 'Alice',
        handle: 'alice#0001',
        isBot: false,
        content: 'hello',
        sentAt: new Date('2026-08-10T12:00:00.000Z'),
        ...overrides,
    };
}

describe('formatConversation', () => {
    it('does not disambiguate a displayName that only one userId uses', () => {
        const result = formatConversation([
            makeMessage({ userId: 'u1', displayName: 'Alice' }),
            makeMessage({ userId: 'u1', displayName: 'Alice', content: 'second message' }),
        ]);

        expect(result).not.toContain('(alice#0001)');
    });

    it('disambiguates with the handle when two different userIds share a displayName', () => {
        const result = formatConversation([
            makeMessage({ userId: 'u1', displayName: 'Alice', handle: 'alice#0001' }),
            makeMessage({ userId: 'u2', displayName: 'Alice', handle: 'alice#0002' }),
        ]);

        expect(result).toContain('Alice (alice#0001)');
        expect(result).toContain('Alice (alice#0002)');
    });

    it('never disambiguates a displayName unique in the conversation', () => {
        const result = formatConversation([
            makeMessage({ userId: 'u1', displayName: 'Alice', handle: 'alice#0001' }),
            makeMessage({ userId: 'u2', displayName: 'Bob', handle: 'bob#0002' }),
        ]);

        expect(result).not.toContain('(alice#0001)');
        expect(result).not.toContain('(bob#0002)');
    });

    it('prefixes only bot authors with the robot emoji', () => {
        const result = formatConversation([
            makeMessage({ userId: 'u1', displayName: 'Alice', isBot: false }),
            makeMessage({ userId: 'u2', displayName: 'Botty', isBot: true }),
        ]);

        expect(result).not.toContain('🤖 Alice');
        expect(result).toContain('🤖 Botty');
    });

    it('joins multiple messages with the --- separator, one fewer than the message count', () => {
        const result = formatConversation([
            makeMessage({ content: 'first' }),
            makeMessage({ content: 'second' }),
            makeMessage({ content: 'third' }),
        ]);

        expect(result.split('\n\n---\n\n')).toHaveLength(3);
        expect(result).toContain('first');
        expect(result).toContain('second');
        expect(result).toContain('third');
    });

    it('includes a structurally correct header, without pinning the locale-dependent date/time text', () => {
        const result = formatConversation([
            makeMessage({ userId: 'u42', displayName: 'Alice', content: 'hi' }),
        ]);

        expect(result).toMatch(/^👤 Alice \[ID:u42\] • 🕐 .+\nhi$/);
    });

    it('returns an empty string for no messages', () => {
        expect(formatConversation([])).toBe('');
    });
});

describe('createNaturalChatInstruction', () => {
    it('names the triggering user', () => {
        expect(createNaturalChatInstruction('Alice')).toContain('Alice');
    });
});
