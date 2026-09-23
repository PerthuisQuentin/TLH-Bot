# Streak rework

Working document for the streak rework, filled in step by step. Intent and decisions only: once a step ships, its behaviour moves to `docs/shells.md` (and the `SYSTÈME DE COQUILLAGES` block of `app/commons/prompts.ts`), and this file keeps the why.

## Current state

What the streak does today, as the baseline every step is measured against.

- **Unit**: consecutive Europe/Paris calendar days with at least one earning event. A reaction counts, on purpose: the series measures showing up.
- **Break**: a whole day without earning sends the series back to 1 on the next earning event. `currentValue` already reads 0 once two days have passed, so displays don't show a dead series.
- **Multiplier**: `1 + min(max(streak − 1, 0), 6) / 6`, linear from ×1.00 (day 1) to ×2.00 (day 7+), capped.
- **Applies to**: message and reaction gains of the earner, multiplied with heat (ceiling ×4.0). Not to passive income, the jackpot, or the author's share of a reaction.
- **Prestige**: kept across a reset.
- **Storage**: `streak: { value, lastDate }` in the game instance (`lastDate` is `YYYY-MM-DD`).

## Touch points

| Where                               | Role                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `app/idle/core/streak.ts`           | `Streak` class: `update`, `currentValue`, `getMultiplier`   |
| `app/idle/core/game-instance.ts`    | persisted shape, `updateStreak`, kept by `prestige`         |
| `app/idle/handlers/handle-event.ts` | earn pipeline: update, then multiply with heat              |
| `app/idle/shells-profile.ts`        | `streakText` shown by `/shells` and the LLM profile tool    |
| `app/commons/prompts.ts`            | player-facing rules (`SYSTÈME DE COQUILLAGES`)              |
| `docs/shells.md`                    | Daily streak section                                        |
| `app/commons/types.ts`              | legacy `streak` / `lastStreakDate` fields (migration input) |
| `npm run sandbox`                   | compressed-clock simulation to check any new curve          |

Any change to the persisted shape needs a migration or a schema default: see `docs/storage.md`.

## Ideas on the table

Collected from `docs/shells-backlog.md` and discussion. Not decisions.

- Notification when the streak is about to expire.
- Progressive bonus beyond 7 days (milestones at 14, 30 days).
- First message of the day bonus, possibly shown as a streak milestone.
- Streak achievement (7-day streak) in the achievements idea.

## Goals

_What the rework must achieve, and what it must not break._

- **Durable**: the bonus keeps growing past the first week instead of topping out at day 7.
- **Less punitive**: missing a day costs nothing. The counter pauses, it never goes down.
- **Renamed**: without a reset it is no longer a streak. Players see **Stries de croissance** ("stries" for short), the code says `growthRings`: a shell grows by fine lines, one per active day, that never go away.

## Design steps

Each step is shippable on its own. Fill in the decision before coding, the outcome after.

### Step 1: growth rings, additive, capped at ×2

- **Goal**: a slow bonus that keeps its value, instead of a 7-day ramp that a single missed day wipes out.
- **Decision**: `multiplier = min(1 + 0.01 · days, 2)`, so the cap of ×2 is reached at 100 days. `days` counts active Paris days, consecutive or not; a missed day pauses the count, no penalty.
- **Numbers**:

    | Days     | 7     | 30    | 70    | 100   | 180   | 365   |
    | -------- | ----- | ----- | ----- | ----- | ----- | ----- |
    | step 1   | ×1.07 | ×1.30 | ×1.70 | ×2.00 | ×2.00 | ×2.00 |
    | uncapped | ×1.07 | ×1.30 | ×1.70 | ×2.00 | ×2.80 | ×4.65 |
    | today    | ×2.00 | ×2.00 | ×2.00 | ×2.00 | ×2.00 | ×2.00 |

    Arithmetic only. The effect on progression still has to be simulated.

- **Rename**: `Streak` → `GrowthRings` (`app/idle/core/growth-rings.ts`), `updateStreak` → `addGrowthRing` or similar, `streakText` → `growthRingsText`, display `Stries : 42 jours 🐚 — ×1.42`. No "streak" left in code, UI, prompts or docs outside history.
- **Data change / migration**: the JSON field `streak: { value, lastDate }` becomes `growthRings: { days, lastDate }`, converted by a one-shot script (A4), with no read compat in the code. `days = streak.value` as stored: the length of the last series, broken or not, so a lower bound of the real active days.
- **Docs to update**: `docs/storage.md` (field table), `docs/scripts.md` (the rewrite), `docs/shells.md` (Daily streak), `prompts.ts` (`SYSTÈME DE COQUILLAGES`), `docs/shells-backlog.md` (Enhanced streak).
- **Status**: to do

### Step 2: unlock conditions and a "Trésors" shop page

Infrastructure only, shippable before the cap-lifting upgrade exists: it moves the seedling and changes nothing to balance.

- **Goal**: an upgrade decides for itself whether it can be seen and bought. The shop only renders what the upgrade answers.
- **Decision**:
    - **Page is declared on the upgrade.** New required `UpgradeMeta.shopPage`, a string enum `ShopPage` (`SHELLS`, `CORAL`, `TREASURES`) in `app/idle/core/types.ts`. Pages are no longer derived from `costResourceId`, since the Trésors page mixes currencies (seedling in shells, cap-lifter in coral).
    - **Unlock condition on the upgrade.** `BaseUpgrade.isUnlocked(ctx)`, `true` by default, overridden per upgrade. `ctx` is a narrow read-only `UnlockContext` built by `GameInstance`: upgrade levels, and the active-day counter (needed by step 3). Seedling: always. Reef, polyps, cap-lifter: seedling owned.
    - **Visibility on the upgrade.** `isVisible(ctx) = isUnlocked(ctx) && !isMaxed`. Replaces `isSettled` in `shop.ts`: a bought one-shot disappears.
    - **`GameInstance` enforces it.** `isUpgradeUnlocked(id)` for readers, and `buyUpgrade` refuses a locked upgrade, so no path (shop, sandbox auto-buyer, simulations) can buy one. `coralUnlocked` stays, prestige still reads it.
- **Shop (`app/commands/shop.ts`)**, renders only:
    - Pages from the registry's `shopPage` values, listing only visible upgrades. "Autres rayons" lists only pages with at least one visible upgrade, which subsumes the hard-coded coral check.
    - Trésors page: the header shows the balance of each currency priced on the page; each field already quotes its own currency.
    - Coral page while locked: the "door" embed now points to `/shop page:Trésors` for the seedling. Trésors page with nothing left: a short "rien pour l'instant" line.
    - Purchase: the `currency === CORAL && !coralUnlocked` guard becomes `!instance.isUpgradeUnlocked(id)`, same `locked` reply, still before any price is quoted.
- **Other readers**: `app/idle/shells-profile.ts` (and through it the LLM profile tool) filters upgrades with `isUnlocked` instead of the coral cost check, so a locked upgrade's price is never quoted by the bot either.
- **Data change / migration**: none. Levels are unchanged, only where upgrades are shown moves.
- **Discord**: the `page` option gains a choice, so the command definitions must be re-registered (user runs `npm run register` / `register:prod`).
- **Tests**: unlock and visibility on `base-upgrade` / each upgrade, `buyUpgrade` refusing a locked id, shop listing per page and the locked purchase, profile filtering.
- **Docs to update**: `docs/commands.md` (page choices), `docs/shells.md` (upgrades, where the seedling is sold), `prompts.ts`, `.claude/skills/add-upgrade` (new required `shopPage`, optional `isUnlocked`).
- **Status**: to do

### Step 3: upgrade that lifts the ×2 cap

- **Goal**: let the additive growth continue past ×2 for players who invest in it.
- **Decision**: a one-shot coral upgrade (permanent, like the counter itself) on the Trésors page. Unlocked once the seedling is owned **and** the counter has reached 100 days. It removes the cap of step 1 and disappears from the shop once bought. Days keep counting above the cap; only the bonus is capped, so buying it at day 150 applies ×2.50 at once. Target: affordable around day 150, or a little before. Price: **32 coral**. At 500 msg/day that is reachable with the day-143 prestige (62 coral), not before: 28 coral earned in total by day 111.
- **Numbers**: coral earned by day ~150 (`simulate-prestige.ts --days=200`, default ratio 2):

    | Profile      | First prestige | Coral earned by ~day 150 |
    | ------------ | -------------- | ------------------------ |
    | 150 msg/day  | day 110        | 1                        |
    | 500 msg/day  | day 33         | ~90                      |
    | 2000 msg/day | day 10         | ~1.8M                    |

    Detail at 500 msg/day (`--days=150`): prestiges on days 33, 56, 86, 111, 143. The one on day 143 pays 62 coral, for 90 earned in total. The cheapest-first buyer has spent about 84 by then (reef levels 1 to 3: 1 + 4 + 16, polyps levels 1 to 6: 63), leaving about 6 unspent. Next prestige around day 170, worth about 185.

    Six orders of magnitude between profiles: a coral price alone cannot land on "day 150" for everyone. Caveat: `--messages-per-day` folds the old streak in; a weaker early bonus lowers every profile.

- **Data change / migration**: a new upgrade id, `maxLevel = 1`, `resetOnPrestige = false`, `shopPage = TREASURES`.
- **Docs to update**: `docs/shells.md` (upgrades), `prompts.ts`, `docs/prestige-design.md` (a new coral upgrade).
- **Status**: to do

## Implementation plan

The design steps above say _what_; this says _in which order it gets built_. Part A changes no balance and no player-facing number: it lays the ground, each step shippable and revertable on its own. Part B is the rework itself.

Every step ends with the four checks (`npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm test`) clean, its docs updated, and one PR.

### Part A: prerequisites

#### A1. Shop page declared on the upgrade

- New string enum `ShopPage` (`SHELLS`, `CORAL`; `TREASURES` joins in A3, with its first upgrade) in `app/idle/core/types.ts`, required `UpgradeMeta.shopPage` + getter on `BaseUpgrade`.
- Every existing upgrade declares its current page (seedling stays on `SHELLS` for now).
- `shop.ts`: `SHOP_PAGES` derived from `shopPage` instead of `costResourceId`; listing filters on `shopPage`.
- Behaviour: identical. Tests: registry covers every page, shop listing unchanged.
- Page display names live in `shop.ts` (`PAGE_NAMES`); the header lists the balance of every currency priced on the page. Option values and names unchanged, so no re-register.
- Docs: `.claude/skills/add-upgrade` (new required field), `docs/commands.md`, `docs/shells.md`.
- **Status**: done.

#### A2. Unlock condition and visibility on the upgrade

- `UnlockContext` (read-only, upgrade levels only for now) and `BaseUpgrade.isUnlocked(ctx)`, `true` by default. Reef and polyps: seedling owned.
- `BaseUpgrade.isVisible(ctx) = isUnlocked(ctx) && !isMaxed`; `isSettled` leaves `shop.ts`.
- `GameInstance.isUpgradeUnlocked(id)`; `buyUpgrade` refuses a locked upgrade.
- Callers switch from the coral-specific checks to the upgrade's answer: shop listing, "Autres rayons", purchase guard, `shells-profile.ts` (and the LLM tool through it). `coralUnlocked` stays for prestige.
- Behaviour: identical, since the only locked upgrades are the coral ones, which were already hidden. Tests: `isUnlocked` / `isVisible` per upgrade, `buyUpgrade` on a locked id, shop and profile unchanged.
- As built: the condition is static meta, `unlockCondition?: (ctx) => boolean`, like `maxLevel`, plus a French `unlockHint` the shop quotes on a locked purchase. `isCoralUnlocked` lives in `coral-seedling.ts`. The profile filters on unlocked rather than visible, so the assistant can still tell a member they own the seedling. The simulations' buyers filter on visible, or a locked upgrade would stall them.
- Docs: `docs/shells.md` (upgrades), `docs/commands.md`, skill `add-upgrade` (optional `unlockCondition` / `unlockHint`).
- **Status**: done.

#### A3. The Trésors page, seedling moved there

- Seedling `shopPage = TREASURES`.
- Trésors page header shows the balance of each currency priced on the page; empty page gets a short French line.
- Locked coral page ("door") points to `/shop page:Trésors`.
- New `page` choice: **you** run `npm run register`, then `register:prod` at deploy.
- Behaviour: first visible change, the seedling moves aisle. Tests: listing of the Trésors page, mixed currencies, empty state, locked coral door.
- As built: the page is `ShopPage.TREASURES`, shown as **Trésors** (chosen over "Spécial"). Page names moved to `app/idle/core/shop-pages.ts` so `/prestige`'s locked reply can name `/shop page:Trésors` too. Page order follows the registry: Coquillages, Trésors, Corail.
- **Status**: done, pending the re-register.
- Docs: `docs/commands.md`, `docs/shells.md`, `prompts.ts` (where the bouture is sold).

#### A4. Rename streak → growth rings, same formula, with its migration

- `Streak` → `GrowthRings` in `app/idle/core/growth-rings.ts` (`days`, `currentDays`, `addRing`, `getMultiplier`), `updateStreak` → `addGrowthRing`, `streakText` → `growthRingsText`. Formula and reset **unchanged**: a diff on behaviour is a bug. The 7-day constant is `FULL_BONUS_DAYS` until B1 replaces the formula.
- JSON: `growthRings: { days, lastDate }`, required. **No read compat in the code**: the transition belongs to the migration script alone, so the code carries no trace of the old name.
- `scripts/migrate-growth-rings.ts` converts every `game-instances.json`: `days = streak.value`, `lastDate` kept, `streak` dropped. Dry run by default, `--apply`, `--guild`, `--dir`; idempotent; validated against the schema before an atomic write. Checked on a copy of the dev data: 4 players converted, everything else byte-identical once reordered, second run writes nothing.
- Player-facing text: "Stries de croissance" in `/shells` (`Stries de croissance : 5 jours — ×1.67`, no emoji since 🐚 is the currency), `prompts.ts` and the LLM tool description.
- Pre-refactor names kept on purpose: `ShellsUser.streak` / `lastStreakDate` in `commons/types.ts` and the input side of `migrate-game-instances.ts`, which describe the old `shells.json` files the REST API still serves.
- **Deploy order**: stop the bot, run the script with `--apply` on the environment's `FILES_DIR`, deploy and start. The old code cannot read the new field: a rollback needs the data from before the run. Same on dev: the local `files/` must be migrated before `npm run dev`.
- **Status**: done.

### Part B: the rework

#### B1. Growth rings: additive, no reset, capped at ×2

- `addGrowthRing`: `days + 1` on the first earning event of a Paris day, whatever the gap. No reset path left.
- `days` getter no longer drops to 0 after a missed day. Multiplier `min(1 + 0.01 · days, 2)`; days keep counting above 100.
- Display: `Stries : 42 jours 🐚 — ×1.42`, and `(plafond atteint)` above 100 while the cap holds.
- Before merging: rerun the simulations with the new early curve (`--messages-per-day` folds the multiplier in, so lower it for the ×1.07 early days) and settle the early-game question below.
- Tests: no reset after a gap, idempotent within a day, cap at 100, count above the cap.
- Docs: `docs/shells.md` (section rewritten), `prompts.ts` (`SYSTÈME DE COQUILLAGES`), `docs/scripts.md` (the 500 msg/day assumption).

#### B2. Cap-lifting upgrade

- `UnlockContext` gains the day count.
- New `UpgradeId`, one-shot: 32 coral, `maxLevel = 1`, `resetOnPrestige = false`, `shopPage = TREASURES`, `isUnlocked` = seedling owned and `days >= 100`. Built with the `add-upgrade` skill.
- `GameInstance` passes "cap lifted" to the multiplier; the banked days above 100 apply at once.
- New `upgrade` choice: **you** re-register.
- Tests: hidden before day 100 or without seedling, visible then gone once bought, multiplier uncapped after purchase, prestige keeps it.
- Docs: `docs/shells.md`, `docs/prestige-design.md` (new coral upgrade and why 32), `prompts.ts`, `docs/commands.md` if the upgrade list is documented there.

#### B3. Cleanup

- Once `migrate-growth-rings.ts` has run in every environment, decide whether to delete it (the last place the old name survives) or keep it next to `migrate-game-instances.ts` as history.
- Move what is still useful here into `docs/shells.md` / `docs/prestige-design.md`, and mark the backlog entry done.

## Open questions

- **Cap-lifter name**: player-facing name of the B2 upgrade ("Coquille millénaire" was floated).
- **Early game**: day 7 goes from ×2.00 to ×1.07, and players below 100 days lose bonus compared to today. Accepted, or keep a fast ramp at the start?

## Later

- **Compound growth** (`1.01^n`): kept for a possible future evolution. Unbounded and exponential (×37.8 at a year, ×1428 at two), so it would need its own cap and a check against the prestige layer, since the streak survives prestige.

## Rejected

_Variants considered and dropped, with the reason, so they don't come back._

-
