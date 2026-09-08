import { describe, it, expect } from 'vitest';
import { parseResponse } from './response.ts';

describe('parseResponse', () => {
    it('returns the text as-is when there is no marker (no trimming on this path)', () => {
        expect(parseResponse('  Hello there.  ')).toEqual({
            response: '  Hello there.  ',
            memory: '',
        });
    });

    it('splits response and memory around the marker, both trimmed', () => {
        const full = 'Hello there.\n### [MÉMOIRE]\nUser likes cats.';
        expect(parseResponse(full)).toEqual({
            response: 'Hello there.',
            memory: 'User likes cats.',
        });
    });

    it('gives an empty response when the marker is at the very start', () => {
        const full = '### [MÉMOIRE]\nUser likes cats.';
        expect(parseResponse(full)).toEqual({
            response: '',
            memory: 'User likes cats.',
        });
    });

    it('gives an empty memory when there is nothing after the marker', () => {
        const full = 'Hello there.\n### [MÉMOIRE]';
        expect(parseResponse(full)).toEqual({
            response: 'Hello there.',
            memory: '',
        });
    });

    it('gives an empty memory when only whitespace follows the marker', () => {
        const full = 'Hello there.\n### [MÉMOIRE]   \n  ';
        expect(parseResponse(full)).toEqual({
            response: 'Hello there.',
            memory: '',
        });
    });
});

// The prompt asks for `### [MÉMOIRE]`, but the instruction lives in each guild's
// system.txt, which no test can reach. A marker the model spells slightly differently
// used to be a silent miss that published the memory half, so these pin the drift the
// split is expected to absorb.
describe('parseResponse, marker variants', () => {
    const variants: Array<[string, string]> = [
        ['the accent dropped, as French does on capitals', '### [MEMOIRE]'],
        ['the English word', '### [MEMORY]'],
        ['lower case', '### [mémoire]'],
        ['mixed case on the English word', '### [Memory]'],
        ['spaces inside the brackets', '### [ MÉMOIRE ]'],
        ['no space after the hashes', '###[MÉMOIRE]'],
        ['two hashes', '## [MÉMOIRE]'],
        ['four hashes', '#### [MÉMOIRE]'],
        // NFD: E + combining acute, written as an escape so no editor or formatter can
        // silently normalize it back to the NFC É the other cases use.
        ['É written as a combining accent (NFD)', '### [ME\u0301MOIRE]'],
    ];

    it.each(variants)('splits on %s', (_label, marker) => {
        expect(parseResponse(`Hello there.\n${marker}\nUser likes cats.`)).toEqual({
            response: 'Hello there.',
            memory: 'User likes cats.',
        });
    });

    // The hashes and brackets are what keep the pattern from firing here: the model
    // talking about its own memory must not truncate the reply.
    it.each([
        'Je garde ça en mémoire, promis.',
        'Ta mémoire [MÉMOIRE] est un concept, pas un titre.',
        '### Mémoire',
    ])('leaves %s untouched', (text) => {
        expect(parseResponse(text)).toEqual({ response: text, memory: '' });
    });
});
