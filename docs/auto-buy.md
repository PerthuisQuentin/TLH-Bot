# Auto-buy of the shells upgrades (working doc)

## Context

Once a player is a few prestiges in, every run starts by buying the same otter, flipper and bag levels by hand. The goal is to automate that step by step with a coral-priced upgrade on the `Trésors` page. It has 3 levels: level 1 automates the otters, level 2 adds the flippers, level 3 adds the bags. The otters should be affordable around the end of the 2nd prestige.

The purchase logic also has to serve the simulations. It becomes a pure planner in `app/idle/core/`: it takes the list of upgrades it may buy plus a strategy, and returns the next purchase. The game and `scripts/sim-common.ts` both call it.

Decisions made in discussion:

- **One global on/off switch**, set through `/shells` and shown on the profile. Without it, auto-buy would spend the balance a player is saving for a manual purchase.
- **In-game strategy: the best payback among what the player can afford right now.** Payback = cost / income gained.
- **Prices: calibrated with the simulator** during the implementation. A reference point for 200 msg/day: 2 🪸 at the 2nd prestige (day ~93), 6 at the 3rd, 19 at the 4th, 58 at the 5th. The automation competes with the reef and the polyps for that coral.

## Current state (baseline)

- `scripts/sim-common.ts` already holds the purchase logic, but only the scripts can use it:
    - `projectedIncome(instance, bumpId)` gives the income with one more level of an upgrade.
    - `candidates()` computes each upgrade's cost and payback.
    - `tryBuy` has two strategies (`cheapest`, `best-payback`, which waits for the best one even when it is not affordable yet). It buys `CUSTOM` upgrades first, in any currency.
    - `spendCoral` buys coral upgrades cheapest first, unlocks first.
- Mechanisms to reuse:
    - `GameInstance.buyUpgrade` enforces the unlock condition, `maxLevel` and affordability.
    - `isUpgradeVisible` tells whether an upgrade is on sale for this player.
    - `isCoralUnlocked` (`core/upgrades/coral-seedling.ts`) gates everything coral.
    - Model for a `CUSTOM` upgrade with levels: `core/upgrades/millennial-shell.ts`.
- `app/idle/shells-profile.ts:75` lists the upgrades that have `maxLevel > 1`, so a 3-level upgrade will appear in `/shells`.
- The `ShopPage.TREASURES` comment in `core/types.ts` says "one-shot unlocks". It needs rewording, since the new upgrade has 3 levels.

## Implementation plan

### Part A: move the planner into core (no behaviour change)

**A1. `app/idle/core/purchase-planner.ts`**

- `projectIncome(instance, bumpId?)`: moved from `sim-common.ts`, logic unchanged. It still mirrors `computeIncome`, growth rings included.
- `enum PurchaseStrategy { CHEAPEST = 'cheapest', BEST_PAYBACK = 'best-payback', BEST_AFFORDABLE_PAYBACK = 'best-affordable-payback' }`.
- `pickPurchase(instance, candidateIds, strategy): UpgradeId | null`. It filters to candidates that are visible and priced in shells, then applies the strategy. It never mutates anything, and it takes a `ReadonlyGameInstance`, imported with `import type`.
- `sim-common.ts`: `tryBuy` calls `pickPurchase(instance, shellPricedUpgradeIds(instance), strategy)`. The `CUSTOM`-first gate stays in the script: it is player behaviour, not a game rule. The simulations accept `--strategy=best-affordable-payback`.
- Tests: `purchase-planner.test.ts`. Cover each strategy, a maxed or locked candidate being ignored, an empty list, and nothing affordable.
- Docs: `docs/shells.md` (a new "Purchase planner" subsection under Upgrades) and `docs/scripts.md` (the new strategy).
- Check: `npm run check:core`. The planner imports only from `core/`.
- No re-register, no migration.
- **Status**: done.
- **As built**: the what-if income is `GameInstance.projectShellsIncome(id)`, not a function in the planner. The planner would have needed a copy of `computeIncome`, which the script version already had ("mirrors computeIncome"). Instead `computeIncome` and the projection share one private `incomeWith(bumpId?)`, so the duplicate is gone. The simulations take `--strategy=best-affordable-payback`, parsed by `strategyArg` in `sim-common.ts`. Seeded outputs of `simulate-idle.ts` and `simulate-prestige.ts` are byte-identical to before the move, with `cheapest` and `best-payback`.

### Part B: the feature

**B1. The upgrade and `GameInstance.runAutoBuy()`**

- New `UpgradeId`, a class in `core/upgrades/<name>.ts`, a registry entry:
    - `CUSTOM` kind, costs `CORAL`, `maxLevel = 3`, `resetOnPrestige = false`.
    - `shopPage = TREASURES`, `unlockCondition = isCoralUnlocked`, with `CORAL_UNLOCK_HINT` as the hint.
    - `AUTOMATION_ORDER = [DIVING_OTTERS, HYDRODYNAMIC_FLIPPERS, HARVEST_BAGS]`: a level `n` automates the first `n` entries.
    - `computeFormatGain` names what is automated.
    - The price is a table of 3 placeholder constants until B4.
- `GameInstance`:
    - `automatedUpgradeIds` (derived from the level).
    - `runAutoBuy()`: loops `pickPurchase(this, automatedUpgradeIds, BEST_AFFORDABLE_PAYBACK)` then `buyUpgrade(id, 1)`. It stops when nothing is affordable, after at most `MAX_LEVELS_PER_PURCHASE` iterations, or when the switch is off. It returns the levels bought per upgrade.
    - `runAutoBuy` and the setter go into the `Omit` of `ReadonlyGameInstance`.
- Rename the `TREASURES` comment.
- Tests: the order the levels unlock in, the choice between otters and flippers, the loop limit, level 0 = no-op.
- **Status**: done.
- **As built**: 🐙 Pieuvre intendante, `stewardOctopus` (name chosen by the user). Placeholder prices 2 / 8 / 30 🪸 in `STEWARD_OCTOPUS_COSTS`. `computeFormatGain` reads `Gère 🦦 Loutres plongeuses, …`. The `Trésors` page is no longer empty after the seedling: three `shop.test.ts` tests now use a maxed Pieuvre for the "nothing left" state, and one new test checks that it is sold. Not wired into the bot yet (B2).
- **Added on request**: once maxed (level 3) the Pieuvre leaves `/shells` as well as `/shop`. `shells-profile.ts` now drops any maxed levelled upgrade from the player's list. The assistant's shop lines still report it as owned.
- **Side effect on the simulations, to settle in B4**: `tryBuy` and `spendCoral` buy the `CUSTOM` upgrades first, so the simulated player now spends its coral on the Pieuvre before the reef, without getting anything from it, since the sim already buys everything every day. On the seeded run the 4th prestige moves from day ~160 to day 185.

**B2. The switch in the data, and hooking into the earn pipeline**

- `GameInstanceJson.autoBuyEnabled: boolean`, a required field (the workflow's no-legacy rule), and `setAutoBuy(enabled)`. It defaults to `true`, so the first automation level works as soon as it is bought.
- One-shot script `scripts/add-auto-buy-flag.ts`: dry run by default, `--apply`, validated, atomic write, idempotent. It runs with the bot stopped, after a backup.
- `app/idle/handlers/handle-event.ts`: `runAutoBuy()` at the end of the synchronous mutator, after the jackpot. The author's share on a reaction does not trigger it: that is not the author's own activity. A `[Shells] AutoBuy | … | bought=…` log line when something was bought.
- Order in the pipeline: every credit lands first (passive, gain, jackpot), then the spending. The run peak (`runMaxShells`) is updated before the spending, so prestige is not penalised by the gain just earned.
- Docs: `docs/storage.md` (the new field), `docs/shells.md` (pipeline step 7b, the automation section).
- **Status**: done.
- **As built**: the switch goes through `setAutoBuy`, and `runAutoBuy` returns nothing while it is off. Every test fixture and both simulations now carry the field. The `AutoBuy` log lists `id+levels`. The auto-buy became step 8 of the pipeline (not "7b"), and `docs/architecture.md` shows it in the flow. Migration checked on copies of `files/` (4 players) and `prod-files/` (28): dry run, apply, then a second run that writes nothing. The strict schema validates the result. Real files untouched.
- **Deploy**: stop the bot, back up `prod-files/`, run `tsx scripts/add-auto-buy-flag.ts --dir=prod-files --apply`, then start the new code. Same for `files/` before an `npm run dev` on this branch, because the new code rejects a file without the field.

**B3. `/shells`: toggle and display**

- A boolean option (name to decide, e.g. `automatisation`). It changes only the requester's own profile: with `user` pointing at someone else, the command refuses. It goes through `updateGameInstance` + `flushGameInstances`, since the player is told the change succeeded. Refused while the upgrade is at level 0.
- The profile shows `Automatisation : activée / désactivée` plus the automated upgrades, only once level ≥ 1. The same data goes to the `get_shells_profile` tool through `shells-profile.ts`.
- `app/commons/prompts.ts`: add the upgrade and the switch in the coral part of `SYSTÈME DE COQUILLAGES`. It stays hidden while the seedling has not been bought.
- Docs: `docs/commands.md`. **Re-register required** (for the user to run).
- **Status**: done.
- **As built**: option `automatisation`. Refusals: someone else's profile ("Vous ne pouvez régler que votre propre automatisation."), and no Pieuvre ("Vous n'avez encore rien à automatiser.", worded so it reveals nothing behind the seedling). A successful change adds "Automatisation activée/désactivée." under the mention, and the profile shows the new state. The profile line `🐙 Automatisation : **activée** · Gère …` sits in the Coquillages field, not in a field of its own. The prompt states the placeholder prices (2 / 8 / 30 🪸): B4 must update them.
- **Reworked on the rebase onto Components V2 (#71, #72)**: `/shells` lost all its options, so the `automatisation` option became a **🐙 Couper / Activer l’automatisation** button on your own profile (`shells:auto-off` / `shells:auto-on`, carrying the target like Refresh). Same refusals, same flush. The profile line now sits in the Coquillages block. No command definition changes any more, so no re-register. In `/shop`, `×10` is left out when fewer than ten levels remain, which removes a nonsense price on the Pieuvre's three.

**B4. Price calibration**

- Add to `simulate-prestige.ts` a player whose shells purchases go only through the automation (`--manual=none`), next to the current one. `spendCoral` has to decide how the automation ranks against the reef and the polyps.
- Measure against the reference run: when each level is bought, and how many days the reef loses. Target: level 1 bought at the end of the 2nd prestige. Then fix the 3 prices.
- Docs: a section in `docs/prestige-design.md` (calibration, rejected prices), and the final prices in `docs/shells.md` and the prompt.
- **Status**: done.
- **As built**:
    - **Rule changed (user decision)**: `runAutoBuy` ranks every shells upgrade on sale and buys only when the pick is automated, else it stops. The old rule (automated only) spent everything on otters at level 1: 14 → 9 prestiges a year for a once-a-day manual buyer at 200 msg/day. With the new rule: 13 with level 1 alone.
    - **Prices 2 / 15 / 80 🪸 (user decision)**: 2nd, 4th and 6th prestige. 2 / 8 / 30 (5th prestige for level 3) gave the same year-end count.
    - `simulate-prestige.ts` gets `--sessions=<n>` (the Pieuvre after each slice, the player by hand once a day) and `--no-octopus`, and prints the day each level is bought. `spendCoral`/`tryBuy` take a `skip` list. Explored first in a scratch script that patched the prices.
    - Results and rejected variants in `docs/prestige-design.md#pieuvre-intendante-calibration`.
    - **Known cost**: at 100 msg/day buying it at the 2nd prestige costs 2 of 6 prestiges a year (coral bottleneck). No price fixes that. The Coquille millénaire moves from day ~160 to ~220 at 200 msg/day when both are bought as soon as possible.

## Open questions (for the user)

- Name and emoji of the upgrade (e.g. 🐙 _Pieuvre intendante_), and the name of the `/shells` option.
- Should auto-buy say anything to the player (silent, or a summary in `/shells` like "last auto-purchase")? Default: silent, log only.

## Later

- **Savings only protected once the manual upgrade is affordable** (review, 2026-09-28). Below that, the Pieuvre still buys an automated level and resets the player's savings, e.g. otters at 10 with 13 000 🐚 while flippers (15 000, twice the payback) are the better buy. Bounded, and not visible in the simulator at level 1 (13 prestiges either way). Left as is to see how players take it. If it matters: switch `runAutoBuy` to `BEST_PAYBACK` (20 prestiges instead of 18 once fully automated, but the Pieuvre then sits idle on a growing balance), or at least word `docs/shells.md`, the upgrade description and the prompt so they no longer promise the balance is always left.

## Verification

- The four checks + `npm run check:core` at every step.
- A1: the simulations give exactly the same tables as before with `cheapest` and `best-payback` (diff of `simulate-prestige.ts` and `simulate-idle.ts` output, before and after).
- B1/B2: `GameInstance` tests and `handle-event.test.ts` (auto-buy after the gain, switch off = no purchase, reaction author not affected). `npm run sandbox` to watch the levels climb on their own on a compressed clock.
- B2: migration dry run on a copy of `files/`, then `--apply`, then reload through the schema.
- B3: `shells.test.ts` (toggle on self, refused on someone else, refused at level 0, display).
- B4: `simulate-prestige.ts` tables with the automation player, archived in `prestige-design.md`.
