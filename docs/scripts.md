# Scripts

Dev and analysis tools under `scripts/`. They run directly with `tsx` and are excluded from the build, so they never reach `dist/`.

They are typechecked all the same: `tsconfig.json` includes them, `tsconfig.build.json` is what `npm run build` uses and is the one that excludes them. Note that `exclude` **replaces** rather than merges through `extends`, which is why the list is repeated in both.

Everything here reads the game rules from `app/idle/core/`, so a new upgrade or a rebalanced curve shows up in these tools with no edit.

`sim-common.ts` is not a tool: it holds what the simulations and the sandbox share, the CLI number parsing, the table renderer and the auto-buy strategies. It is there so the purchase logic exists once.

| Script                 | Purpose                                                               | State                                    |
| ---------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| `analyze-upgrade.ts`   | Level-by-level cost / gain / payback table for one upgrade.           | Ready.                                   |
| `simulate-heat.ts`     | Replays heat scenarios against the real decay constants.              | Ready.                                   |
| `simulate-idle.ts`     | Simulates the progression curve over days.                            | Ready.                                   |
| `simulate-prestige.ts` | Simulates the prestige loop: coral, run lengths, coral upgrades.      | Ready. Drives the shipped curves.        |
| `sandbox.ts`           | Plays the idle game interactively on a compressed clock.              | Ready. `npm run sandbox`.                |
| `check-core-purity.ts` | Fails if `app/idle/core/` depends on a package outside its allowlist. | Ready. Run through `npm run check:core`. |

---

## `analyze-upgrade.ts`

Prints a level-by-level table for one upgrade: the cost of the level, the marginal gain it brings, and the payback in messages.

```bash
tsx scripts/analyze-upgrade.ts <upgrade> <minLevel> <maxLevel> [--base-spm=10]
```

| Argument         | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `<upgrade>`      | Upgrade id or display name. **Exact match only.**                          |
| `<minLevel>`     | Lowest level to show, integer ≥ 1.                                         |
| `<maxLevel>`     | Highest level to show, ≥ `minLevel`.                                       |
| `--base-spm=<n>` | Baseline shells/message used to value multiplicative upgrades. Default 10. |

```bash
tsx scripts/analyze-upgrade.ts divingOtters 1 40
tsx scripts/analyze-upgrade.ts hydrodynamicFlippers 1 20 --base-spm=25
tsx scripts/analyze-upgrade.ts harvestBags 5 25 --base-spm=120
```

How the numbers are computed:

- The cost of level N is the price of going from N−1 to N.
- For an additive upgrade, the level gain is the direct delta in shells/message.
- For a multiplicative one, it is `base-spm × (mult(N) − mult(N−1))`.
- Payback in messages is cost ÷ gain.

Pick `--base-spm` close to the income of the player you are reasoning about. A multiplicative upgrade is worth exactly nothing at low income and everything at high income, so the default of 10 will make flippers and bags look terrible.

The upgrade list comes from the registry, so a newly added upgrade is analysable with no edit here.

---

## `simulate-heat.ts`

Replays five scenarios against the real constants in `core/heat/heat-config.ts`, printing the heat, the multiplier and the resulting gain at each step: a solo talker, two users alternating, a four-user conversation, eight users ramping up then going quiet, and a single user flooding.

That last one is the point of the script — it shows the pairwise formula holding a spammer flat at ×1.0 while a real conversation climbs.

```bash
tsx scripts/simulate-heat.ts
```

No options. Edit the scenarios in the file to test a new shape. Useful when touching the decay constant or the bucket table, since heat is in-memory only and awkward to observe in production.

---

## `simulate-idle.ts`

Simulates one player's progression over days, auto-buying upgrades as they become affordable. No Discord, no writes to `files/`.

```bash
tsx scripts/simulate-idle.ts                                    # one year, defaults
tsx scripts/simulate-idle.ts --days=90 --every=7
tsx scripts/simulate-idle.ts --strategy=best-payback
tsx scripts/simulate-idle.ts --days=30 --delay=200              # live screen
```

| Option                   | Default    | Description                                                                                                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--days=<n>`             | 365        | Days to simulate.                                                                                                                              |
| `--messages-per-day=<n>` | 200        | **Effective** message count per day — see below.                                                                                               |
| `--start-shells=<n>`     | 0          | Starting capital, credited exactly.                                                                                                            |
| `--strategy=<mode>`      | `cheapest` | `cheapest` buys the cheapest affordable level; `best-payback` waits for the level that amortises fastest rather than settling for a worse one. |
| `--delay=<ms>`           | 0          | `0` prints a progression table. Above 0, refreshes a live screen once per simulated day.                                                       |
| `--every=<n>`            | auto       | Sample one table row every N days. Defaults to about 25 rows.                                                                                  |

### The one input that matters

`--messages-per-day` counts message-_equivalents_, not messages. **Growth rings are modelled**: the simulated player is active every day, so each simulated day adds a ring (`playMessages` in `sim-common.ts`, on a virtual calendar) and the day's messages are paid at the rings' multiplier, ×1.01 on day one, ×2 from day 100, uncapped once the Coquille millénaire is bought. Heat, passive income and the jackpot are **not** modelled and stay folded into the count.

The default of 200 comes from a member sending roughly 100 real messages a day: once heat (×1–2) and passive income are applied, that earns about what 200 plain messages would. It is a rough figure, and it is the knob to turn when you want a different player profile — a quiet member is nearer 30, a very active one during a busy week nearer 800.

Two consequences worth knowing. The simulation is only as good as that number, so treat the output as the _shape_ of the curve rather than a forecast. And a day's earnings go through the real `GameInstance.applyShellsGain`, so the ±10 % roll is applied once per simulated day: negligible over a year, visible over a week.

### Output

The progression table gives shells, income and the level of each upgrade at sampled days, plus the running count of levels bought. Then the final per-upgrade state — level, current effect, next-level price, what that level would add, and its payback in messages — and the day each power-of-ten income threshold was first crossed.

Purchases are evaluated once per simulated day, after that day's earnings land. A continuous buyer would compound slightly faster.

---

## `simulate-prestige.ts`

Simulates the prestige loop designed in [prestige-design.md](./prestige-design.md): the player runs the shell tree up, converts the run into coral, spends it, and starts over.

```bash
tsx scripts/simulate-prestige.ts                          # one year, default player
tsx scripts/simulate-prestige.ts --prestige-ratio=1       # prestiges as soon as it pays anything
tsx scripts/simulate-prestige.ts --days=120 --messages-per-day=2000
```

| Option                   | Default    | Description                                                                                |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `--days=<n>`             | 365        | Days to simulate.                                                                          |
| `--messages-per-day=<n>` | 200        | Effective message count per day, same meaning as in `simulate-idle.ts`.                    |
| `--strategy=<mode>`      | `cheapest` | How the shell tree is bought, `cheapest` or `best-payback`.                                |
| `--prestige-ratio=<n>`   | 2          | How many times the lifetime coral a run must be worth before the player pulls the trigger. |

There are no curve options. The coral formula, both coral upgrades and what a reset does are read from `app/idle/core/`, and the script drives a real `GameInstance` through `applyShellsGain`, `buyUpgrade` and `prestige`. Rebalancing means editing the core and re-running this, exactly as with `simulate-idle.ts`.

What the script still owns is the part the game has no opinion on: **when a player chooses to prestige**, which is `--prestige-ratio`, and the naive cheapest-first buying that stands in for a player. A one-shot unlock (`CUSTOM`) is bought first, in shells or coral, as soon as it is on sale and affordable: the seedling, then the Coquille millénaire.

One ordering the simulation inherits from the real code: coral is spent **after** the reset, so a level bought now only pays from the next run on. That is what a player gets, since they prestige first and walk into the shop after.

### Reading the output

One row per prestige: the day it happened, how long the run lasted, the peak it reached, coral gained and total, and the level of each coral upgrade afterwards. The summary lines give the first prestige day, how run lengths evolved, which is the number that matters, and the growth rings at the end with the day the Coquille millénaire lifted their cap. A calibration is healthy when runs get **gradually longer** without freezing: the layer is meant to run out of steam slowly, leaving room for the next one. Runs that keep shortening from one prestige to the next mean an upgrade is over the runaway line, see [prestige-design.md](./prestige-design.md). Since the rings are modelled, some shortening is expected over a year: at 200 msg/day runs settle around 24 days with the cap held at ×2, around 18 once it is lifted, without crashing.

Two failure modes to watch for:

- **Runaway.** If the reef's gain per level reaches the ×2 of its cost, run lengths crash to a handful of days and the numbers leave any useful range.
- **Grind.** Too high a `CORAL_EXPONENT` freezes run lengths at a constant and the loop stops being a progression.

---

---

## `sandbox.ts`

Plays the shells game on its own, with no Discord, no storage and no AI. Where the two
simulations answer _what do these curves produce over a year_, this one answers _what does it
feel like to play them_.

```bash
npm run sandbox                                  # 200 msg/day, a quarter day per second
npm run sandbox -- --messages-per-day=150        # a quieter member
npm run sandbox -- --speed=2 --auto              # fast, with the naive buyer driving
tsx scripts/sandbox.ts --frames=40               # render without a terminal, for a check
```

| Option                 | Default | Meaning                                                      |
| ---------------------- | ------- | ------------------------------------------------------------ |
| `--messages-per-day=N` | 200     | Effective messages a day, the same unit the simulations use. |
| `--speed=N`            | 0.25    | Virtual days per real second. Snaps to the nearest step.     |
| `--auto`               | off     | Start with the cheapest-first auto-buyer on.                 |
| `--frames=N`           | —       | Headless: render N ticks and exit, no raw mode.              |

| Key     | Action                                               |
| ------- | ---------------------------------------------------- |
| `1`-`9` | Buy the current quantity of that upgrade.            |
| `x`     | Cycle the purchase size: 1, 10, max affordable.      |
| `a`     | Toggle the auto-buyer.                               |
| `p`     | Prestige, or say what the run peak is still missing. |
| `+` `-` | Walk the speed steps, 0.05 to 10 days per second.    |
| `space` | Pause the clock.                                     |
| `r`     | Start over at day 0.                                 |
| `q`     | Quit, restoring the terminal.                        |

**The clock is virtual.** A tick advances the day counter by `speed × 0.1`, and the messages
that many days are worth are paid through `playMessages`, like the simulations: one growth ring
per virtual day, messages at the rings' multiplier, shown on their own line. At the default
speed a first prestige lands around day 63, about four minutes of wall time.

**Heat and passive income are not modelled.** They are folded into the message rate, the same
convention the simulations use: both key off wall-clock times, which a virtual clock cannot
drive honestly, so the sandbox does not pretend to model them. Everything else —
prices, incomes, the coral formula, what a prestige resets — is read from `app/idle/core/`, so
a rebalanced curve shows up here with no edit.

**It never prestiges for you**, even with `--auto` on: when to reset is the decision the whole
layer is built around, and automating it would answer the question the sandbox exists to ask.
For a hands-off run over a year, that is what `simulate-prestige.ts` is.

## `check-core-purity.ts`

Reads every emitted file under `dist/app/idle/core/` and fails if one imports a package other than `decimal.js` or `zod`. It checks the build output rather than the sources because that is where an enum imported from outside `core/` shows up as the runtime dependency it is.

```bash
npm run check:core     # builds, then runs the check
```

Exits 1 with the offending file and package when it fails, 0 otherwise. Why the rule exists: [tooling.md](./tooling.md#core-purity).
