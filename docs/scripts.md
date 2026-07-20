# Scripts

Dev, analysis and migration tools under `scripts/`. They run directly with `tsx` and are excluded from the build, so they never reach `dist/`.

They are typechecked all the same: `tsconfig.json` includes them, `tsconfig.build.json` is what `npm run build` uses and is the one that excludes them. Note that `exclude` **replaces** rather than merges through `extends`, which is why the list is repeated in both.

Everything here reads the game rules from `app/idle/core/`, so a new upgrade or a rebalanced curve shows up in these tools with no edit.

| Script                      | Purpose                                                     | State                            |
| --------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `migrate-game-instances.ts` | Builds `game-instances.json` from the legacy files.         | Ready. Run once per environment. |
| `analyze-upgrade.ts`        | Level-by-level cost / gain / payback table for one upgrade. | Ready.                           |
| `simulate-heat.ts`          | Replays heat scenarios against the real decay constants.    | Ready.                           |
| `simulate-idle.ts`          | Simulates the progression curve over days.                  | Ready.                           |

---

## `migrate-game-instances.ts`

Builds `{guildId}-game-instances.json` from the pre-refactor `shells.json` + `upgrades.json` pair.

**This must run once per environment before the refactored bot starts.** A missing `game-instances.json` reads back as `[]`, and every player restarts from zero.

```bash
tsx scripts/migrate-game-instances.ts            # dry run — reads, reports, writes nothing
tsx scripts/migrate-game-instances.ts --apply
```

| Flag                 | Effect                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `--apply`            | Actually writes. Without it the script only reports.                                                |
| `--guild=<id>`       | Restrict to one guild. Default: every guild found in the directory.                                 |
| `--dir=<path>`       | Data directory. Defaults to `FILES_DIR`, then `files`.                                              |
| `--force`            | Overwrite an existing `game-instances.json`.                                                        |
| `--recompute-income` | Derive shells income (`income.shells`) from the upgrade levels instead of copying the stored value. |

### Reading the report

Watch for `income mismatch` warnings. By default the script copies each player's stored income verbatim, so **no one's income changes** — but a mismatch means `shells.json` and `upgrades.json` had drifted apart, and one of the two is wrong. The report prints both values at full precision alongside the upgrade levels, so you can tell which.

`--recompute-income` trusts the levels over the stored value. That is a gameplay change, not a format change, which is why it is off by default.

The script refuses to overwrite an existing `game-instances.json` without `--force`: once the bot has started, that file is authoritative and the legacy pair is stale. Output is validated against the zod schema and written atomically.

`shells.json` and `upgrades.json` are left in place — the REST API still exposes them.

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
| `--messages-per-day=<n>` | 500        | **Effective** message count per day — see below.                                                                                               |
| `--start-shells=<n>`     | 0          | Starting capital, credited exactly.                                                                                                            |
| `--strategy=<mode>`      | `cheapest` | `cheapest` buys the cheapest affordable level; `best-payback` waits for the level that amortises fastest rather than settling for a worse one. |
| `--delay=<ms>`           | 0          | `0` prints a progression table. Above 0, refreshes a live screen once per simulated day.                                                       |
| `--every=<n>`            | auto       | Sample one table row every N days. Defaults to about 25 rows.                                                                                  |

### The one input that matters

Heat, streak, passive income and the jackpot are **not** modelled. They are folded into `--messages-per-day`, which counts message-_equivalents_, not messages.

The default of 500 comes from a member sending roughly 100 real messages a day: once heat (×1–2), streak (×1–2) and passive income are applied, that earns about what 500 plain messages would. It is a rough figure, and it is the knob to turn when you want a different player profile — a quiet member is nearer 50, a very active one during a busy week nearer 2000.

Two consequences worth knowing. The simulation is only as good as that number, so treat the output as the _shape_ of the curve rather than a forecast. And a day's earnings go through the real `GameInstance.applyShellsGain`, so the ±10 % roll is applied once per simulated day: negligible over a year, visible over a week.

### Output

The progression table gives shells, income and the level of each upgrade at sampled days, plus the running count of levels bought. Then the final per-upgrade state — level, current effect, next-level price, what that level would add, and its payback in messages — and the day each power-of-ten income threshold was first crossed.

Purchases are evaluated once per simulated day, after that day's earnings land. A continuous buyer would compound slightly faster.
