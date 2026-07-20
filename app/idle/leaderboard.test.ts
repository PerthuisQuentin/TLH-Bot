import { describe, it, expect } from 'vitest';
import { Leaderboard, LeaderboardSort } from './leaderboard.ts';
import { GameInstance } from './core/game-instance.ts';
import { ResourceId } from './core/types.ts';

function makeInstance(
    userId: string,
    shells: string,
    maxShells: string,
    income: string,
): GameInstance {
    return new GameInstance({
        userId,
        resources: { [ResourceId.SHELLS]: shells },
        stats: { maxShells },
        income: { [ResourceId.SHELLS]: income },
        streak: { value: 0, lastDate: '' },
        lastActiveAt: new Date().toISOString(),
        upgrades: {},
    });
}

describe('Leaderboard sorting', () => {
    // Deliberately conflicting orderings across the three fields, so a test only
    // passes if the sort key actually reads the field it claims to.
    const u1 = makeInstance('u1', '50', '500', '5');
    const u2 = makeInstance('u2', '200', '200', '50');
    const u3 = makeInstance('u3', '10', '100', '20');
    const instances = [u1, u2, u3];

    it('sorts by MAX (the default) descending', () => {
        const board = new Leaderboard(instances);
        expect(board.getPage(1, 10).entries.map((e) => e.userId)).toEqual(['u1', 'u2', 'u3']);
    });

    it('sorts by CURRENT balance descending', () => {
        const board = new Leaderboard(instances, LeaderboardSort.CURRENT);
        expect(board.getPage(1, 10).entries.map((e) => e.userId)).toEqual(['u2', 'u1', 'u3']);
    });

    it('sorts by INCOME descending', () => {
        const board = new Leaderboard(instances, LeaderboardSort.INCOME);
        expect(board.getPage(1, 10).entries.map((e) => e.userId)).toEqual(['u2', 'u3', 'u1']);
    });

    it('assigns rank in the sorted order, 1-indexed', () => {
        const board = new Leaderboard(instances);
        const entries = board.getPage(1, 10).entries;
        expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    });
});

describe('Leaderboard.getPage', () => {
    const instances = Array.from({ length: 25 }, (_, i) =>
        makeInstance(`u${i}`, '0', String(100 - i), '0'),
    );
    const board = new Leaderboard(instances);

    it('paginates a full first page', () => {
        const page = board.getPage(1, 10);
        expect(page.entries).toHaveLength(10);
        expect(page.entries[0].userId).toBe('u0');
        expect(page.totalUsers).toBe(25);
        expect(page.totalPages).toBe(3);
        expect(page.currentPage).toBe(1);
        expect(page.startIndex).toBe(0);
    });

    it('paginates a partial last page', () => {
        const page = board.getPage(3, 10);
        expect(page.entries).toHaveLength(5);
        expect(page.entries[0].userId).toBe('u20');
        expect(page.currentPage).toBe(3);
        expect(page.startIndex).toBe(20);
    });

    it('clamps the requested page into [1, totalPages]', () => {
        expect(board.getPage(0, 10).currentPage).toBe(1);
        expect(board.getPage(99, 10).currentPage).toBe(3);
    });

    it('falls back to a page size of 10 for an invalid pageSize', () => {
        expect(board.getPage(1, 0).pageSize).toBe(10);
        expect(board.getPage(1, -5).pageSize).toBe(10);
        expect(board.getPage(1, 2.5).pageSize).toBe(10);
    });

    it('returns the exact empty shape for an empty leaderboard', () => {
        const empty = new Leaderboard([]);
        expect(empty.getPage(1, 10)).toEqual({
            entries: [],
            totalUsers: 0,
            totalPages: 0,
            currentPage: 1,
            startIndex: 0,
            pageSize: 10,
        });
    });

    it('normalizes an invalid pageSize on the empty-list branch too', () => {
        // It used to echo the raw value back here, and only here: the fallback sat below
        // the early return, so the reported page size depended on whether anyone had shells.
        const empty = new Leaderboard([]);
        expect(empty.getPage(1, 0).pageSize).toBe(10);
        expect(empty.getPage(1, -5).pageSize).toBe(10);
        expect(empty.getPage(1, 2.5).pageSize).toBe(10);
    });
});

describe('Leaderboard.getUserEntry', () => {
    const instances = [makeInstance('u1', '0', '500', '0'), makeInstance('u2', '0', '200', '0')];
    const board = new Leaderboard(instances);

    it('finds an existing user with their rank', () => {
        expect(board.getUserEntry('u2')).toMatchObject({ userId: 'u2', rank: 2 });
    });

    it('returns null for an unknown user', () => {
        expect(board.getUserEntry('nope')).toBeNull();
    });
});

describe('Leaderboard.totalUsers', () => {
    it('reflects the number of instances passed in', () => {
        const board = new Leaderboard([makeInstance('u1', '0', '0', '0')]);
        expect(board.totalUsers).toBe(1);
    });
});
