import { describe, it, expect } from 'vitest';
import { hasNicknameMention, shouldTriggerChat, ChatTriggerKind } from './chat-trigger.ts';

describe('hasNicknameMention', () => {
    it('matches a nickname as a case-insensitive substring', () => {
        expect(hasNicknameMention('Salut Gégé, ça va ?', ['gégé'])).toBe(true);
        expect(hasNicknameMention('SALUT GÉGÉ', ['Gégé'])).toBe(true);
    });

    it('returns false when no nickname is present', () => {
        expect(hasNicknameMention('Salut tout le monde', ['gégé', 'le bot'])).toBe(false);
    });

    it('returns false for an empty or absent nickname list', () => {
        expect(hasNicknameMention('le bot est nul', [])).toBe(false);
    });

    it('ignores blank entries in the nickname list', () => {
        expect(hasNicknameMention('anything', ['', '   '])).toBe(false);
    });

    // What lets the config hold the short forms people actually type. A substring rule
    // would make "bot" unusable, and it is the one that covers "le bot", "ce bot", "un
    // bot" and the rest without listing each.
    it.each([
        ['le bot est cassé', true],
        ['bot ?', true],
        ['tu fais quoi, bot', true],
        ['un robot aspirateur', false],
        ['mes bottes sont sales', false],
        ['le sabot du cheval', false],
        ['sabotage complet', false],
    ])('matches %s as a whole word: %s', (content, expected) => {
        expect(hasNicknameMention(content, ['bot'])).toBe(expected);
    });

    // JS \b is built on [A-Za-z0-9_], so it finds no boundary after the final "é" and
    // would silently never match — the reason this uses Unicode lookarounds instead.
    it('still matches a nickname ending on an accent', () => {
        expect(hasNicknameMention('Gégé tu dors ?', ['gégé'])).toBe(true);
        expect(hasNicknameMention('gégé', ['gégé'])).toBe(true);
    });

    it('does not match a nickname glued inside a longer word', () => {
        expect(hasNicknameMention('gérardine est là', ['gérard'])).toBe(false);
    });

    // A config value is data: a nickname with regex syntax must not become a pattern.
    it('treats regex metacharacters in a nickname literally', () => {
        expect(hasNicknameMention('salut g.rard', ['g.rard'])).toBe(true);
        expect(hasNicknameMention('salut gerard', ['g.rard'])).toBe(false);
    });
});

describe('shouldTriggerChat', () => {
    it('always returns direct when directly mentioned, regardless of probabilities', () => {
        expect(
            shouldTriggerChat({
                isDirectMention: true,
                hasIndirectMention: false,
                indirectProbability: 0,
                randomProbability: 0,
                random: () => 0.999,
            }),
        ).toBe(ChatTriggerKind.DIRECT);
    });

    it('returns indirect when the roll is under the indirect probability', () => {
        expect(
            shouldTriggerChat({
                isDirectMention: false,
                hasIndirectMention: true,
                indirectProbability: 0.1,
                randomProbability: 0.01,
                random: () => 0.05,
            }),
        ).toBe(ChatTriggerKind.INDIRECT);
    });

    it('returns null for indirect mention when the roll is over the indirect probability', () => {
        expect(
            shouldTriggerChat({
                isDirectMention: false,
                hasIndirectMention: true,
                indirectProbability: 0.1,
                randomProbability: 0.01,
                random: () => 0.5,
            }),
        ).toBeNull();
    });

    it('returns random when no mention matched and the roll is under the random probability', () => {
        expect(
            shouldTriggerChat({
                isDirectMention: false,
                hasIndirectMention: false,
                indirectProbability: 0.1,
                randomProbability: 0.01,
                random: () => 0.005,
            }),
        ).toBe(ChatTriggerKind.RANDOM);
    });

    it('returns null when no mention matched and the roll is over the random probability', () => {
        expect(
            shouldTriggerChat({
                isDirectMention: false,
                hasIndirectMention: false,
                indirectProbability: 0.1,
                randomProbability: 0.01,
                random: () => 0.5,
            }),
        ).toBeNull();
    });
});
