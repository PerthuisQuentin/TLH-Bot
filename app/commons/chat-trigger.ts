export enum ChatTriggerKind {
    DIRECT = 'direct',
    INDIRECT = 'indirect',
    RANDOM = 'random',
}

/** Nicknames come from the guild config, so they are matched literally, never as syntax. */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word match, not substring: "bot" has to catch "le bot ?" without firing on
 * "robot", "sabot" or "bottes". JS `\b` cannot express this here — it is built on
 * [A-Za-z0-9_], so an accented edge carries no boundary and `\bgégé\b` never matches
 * "Gégé". The lookarounds ask for "no letter or digit on either side", in any alphabet.
 */
export function hasNicknameMention(content: string, nicknames: string[]): boolean {
    return nicknames.some((nickname) => {
        const trimmed = nickname.trim();
        if (trimmed === '') return false;

        return new RegExp(
            `(?<![\\p{L}\\p{N}])${escapeRegex(trimmed)}(?![\\p{L}\\p{N}])`,
            'iu',
        ).test(content);
    });
}

type ShouldTriggerChatParams = {
    isDirectMention: boolean;
    hasIndirectMention: boolean;
    indirectProbability: number;
    randomProbability: number;
    random?: () => number;
};

export function shouldTriggerChat({
    isDirectMention,
    hasIndirectMention,
    indirectProbability,
    randomProbability,
    random = Math.random,
}: ShouldTriggerChatParams): ChatTriggerKind | null {
    if (isDirectMention) return ChatTriggerKind.DIRECT;
    if (hasIndirectMention) return random() < indirectProbability ? ChatTriggerKind.INDIRECT : null;
    return random() < randomProbability ? ChatTriggerKind.RANDOM : null;
}
