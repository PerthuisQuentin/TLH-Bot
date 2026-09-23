# Leaderboard sort by growth rings

Temporary working doc. Intent and decisions only; behaviour lives in `docs/commands.md` once shipped.

## Current state

- `/leaderboard` and the `get_leaderboard` LLM tool share `app/idle/leaderboard-view.ts`, which builds on `app/idle/leaderboard.ts`.
- `LeaderboardSort` has `max` (default), `current` and `income`. `Leaderboard._sortKey` returns one `BigNum` per sort, compared with `bnCompare`. Ties keep file order (stable sort).
- Every line has the same format whatever the sort: `#1 <@x> — {maxShells} 🐚 *({shells} · +{income}/msg)*`.
- Growth rings (`growthRings.days`, a plain `number`) appear only in `/shells`.
- Prod (`1379…`, 28 players): days `120,120,120,120,119,77,53,…`, with 9 players at 1 and 5 at 0. Ties are common.

## Touch points

- `app/idle/leaderboard.ts`, `app/idle/leaderboard.test.ts`
- `app/idle/leaderboard-view.ts`
- `app/commands/leaderboard.ts` (new choice, so a re-register)
- `app/llm/tools/leaderboard.ts`, `app/llm/tools/leaderboard.test.ts` (sort description)
- `app/commons/prompts.ts` (the `/leaderboard` line)
- `docs/commands.md`

## Goals

- Players can rank the server by growth ring days.
- The line shows the value being ranked on.

## Decisions

- **Value `rings`, label « Stries de croissance ».** Matches the `/shells` wording, and the value stays short for the LLM tool and the footer.
- **Ties are broken by `maxShells` descending.** This is consistent with the default sort. File order would be arbitrary, and a shared rank would change the numbering and the pinned-rank logic.
- **Line format changes for this sort only:** `#1 <@x> — 🌀 120 j (×2.00) · {maxShells} 🐚`. It leads with the ranked value. The multiplier is `growthRingsMultiplier`, so a Coquille millénaire owner shows more than ×2. The other sorts keep today's line.

## Design steps

1. Replace the single `BigNum` sort key with a comparator per sort, so a `number` key and a tie-break fit.
2. `LeaderboardEntry` carries `growthRingDays` and `growthRingsMultiplier`.
3. `formatLeaderboardEntry` takes the sort and picks the line format.
4. The new choice goes in the command, the tool description, `prompts.ts` and `docs/commands.md`.

## Open questions

- None.

## Later

- Footer shows the raw sort value (`tri : max`, `tri : rings`) rather than the French label.

## Rejected

- Shared rank on ties: changes numbering and the pinned-entry logic for little gain.
- Adding rings to every line whatever the sort: longer lines everywhere; the user chose a per-sort format.
- Value `growth_rings`: longer in the footer and tool args for no clarity gain.

## Implementation plan

No Part A: the change is small and self-contained.

### Part B, step 1: rings sort

- **Changes**: design steps 1 to 4.
- **Tests**: `leaderboard.test.ts` covers ordering by days, the tie-break by `maxShells`, and entry fields. `leaderboard-view` covers the rings line vs. the default line, through the tool test or a new one. `llm/tools/leaderboard.test.ts` checks that `sort: "rings"` is accepted.
- **Docs**: `docs/commands.md` (`sort` option, line format per sort), `prompts.ts`.
- **Deploy**: re-register (`npm run register`, then `register:prod`). No data migration.
- **As built**: as planned. `Leaderboard._sortKey` became `_compare`, with the tie-break only on `rings`. The multiplier is in the line. The `prompts.ts` line also states the tie-break.
- **Status**: done, not committed.
