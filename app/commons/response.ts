/**
 * Half of a contract whose other half is the response-format block of each guild's
 * `system.txt`, which is not in the repo and so cannot be kept in sync by a test. What
 * the prompt asks for is `### [MÉMOIRE]`; this accepts the ways a model drifts off it,
 * because a miss is silent and costly — the split never fires and the memory notes are
 * posted to the channel instead of being persisted.
 *
 * Tolerated: the accent dropped (French omits it on capitals more often than not), the
 * English word, any case, two to four hashes, spaces inside the brackets.
 * Still required: the hashes and the brackets, so the word alone in a sentence cannot
 * truncate a reply.
 */
const MEMORY_MARKER = /#{2,4}\s*\[\s*(?:M[EÉ]MOIRE|MEMORY)\s*\]/i;

export function parseResponse(fullResponse: string): {
    response: string;
    memory: string;
} {
    // É has two encodings that render identically: NFC (U+00C9) and NFD (E + combining
    // acute). Only the first would match, so both halves are normalized before the split.
    const normalized = fullResponse.normalize('NFC');
    const match = MEMORY_MARKER.exec(normalized);

    if (match) {
        const response = normalized.slice(0, match.index).trim();
        const memory = normalized.slice(match.index + match[0].length).trim();
        return { response, memory };
    }

    return { response: fullResponse, memory: '' };
}
