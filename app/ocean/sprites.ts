import type { Palette } from './canvas.ts';

// Facing right; drawn mirrored for the other way.

/** On its back, a shell in its paws. Row 4 sits on the waterline. */
export const OTTER_FLOAT = [
    '...........hhh..',
    '.dd.......hhhhh.',
    '..d...sS..hhehMn',
    '..CCCdsdCChhMMM.',
    'tbbbbbbbbbbbhh..',
    '.bbbbbbbbbbb....',
];

export const OTTER_SWIM = [
    '...........hhh...',
    '.....bbbbbbhhhhh.',
    'ttbbbbbbbbbbhhehM',
    '.ttbbbbbbbbbhhMMn',
    '...bbCCCCCCbbhMM.',
    '....dd.....dd....',
    '...dd.....dd.....',
];

export const OTTER_PALETTE: Palette = {
    b: '#6e4225',
    h: '#7d4d2b',
    C: '#c99a6b',
    M: '#e0c29a',
    d: '#4f2c16',
    t: '#4f2c16',
    e: '#140a04',
    n: '#140a04',
    s: '#f6c9d6',
    S: '#fbe3ea',
};

export const SHELL = ['PQP', 'RPR', '.R.'];

export const SHELL_PALETTES: readonly Palette[] = [
    { P: '#f6c9d6', Q: '#fbe3ea', R: '#c98a9c' },
    { P: '#f7dcb4', Q: '#fff1da', R: '#c49a66' },
    { P: '#efe4de', Q: '#ffffff', R: '#b8a39a' },
];

export const BAG = ['.kkk.', '..k..', '.BbB.', 'BBbBB', 'BBBBB', '.BBB.'];

export const BAG_PALETTE: Palette = { k: '#5a3a1e', B: '#8e6238', b: '#b07f4b' };

export const OCTOPUS = [
    '...ooooo...',
    '..oOOOOOo..',
    '.oOOOOOOOo.',
    '.oOwkOwkOo.',
    '.ooOOOOOoo.',
    '..ooooooo..',
    '.o.oo.oo.o.',
    'o..o..o..o.',
    'oo.o..o.oo.',
    '..oo..oo...',
];

export const OCTOPUS_PALETTE: Palette = { o: '#9b4680', O: '#c766a6', w: '#ffffff', k: '#1a1020' };

export const NAUTILUS = [
    '...nnnn....',
    '..nNNNNn...',
    '.nNnnnNNn..',
    '.nNnSnNNnrr',
    '.nNnnNNNnrrr',
    '..nNNNNnrr.',
    '...nnnn....',
];

export const NAUTILUS_PALETTE: Palette = { n: '#a8704b', N: '#f4dfc4', S: '#6b4526', r: '#d9a27a' };
