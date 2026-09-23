# Prestige design

**Shipped.** What the mechanic does is in [shells.md](./shells.md#prestige), the command in
[commands.md](./commands.md), the data in [storage.md](./storage.md) and the simulator in
[scripts.md](./scripts.md). Those four are the source of truth; if this file disagrees with
one of them, it is this file that is stale.

What lives here is the part that cannot be read off the code: why the numbers are the numbers,
which calibrations were tried and failed, why the currency is coral, and what the layer is
missing. Read it before touching the constants in `core/prestige/prestige-config.ts` or either
coral curve.

## Why

`tsx scripts/simulate-idle.ts --days=180 --messages-per-day=500 --every=30` on the current
curves (one member sending ~100 real messages a day) gives:

| Month | Day | Balance | Income/msg | Otters | Flippers | Bags | Levels bought that month |
| ----- | --- | ------- | ---------- | ------ | -------- | ---- | ------------------------ |
| 1     | 30  | 239K    | 1.04K      | 26     | 10       | 2    | 35                       |
| 2     | 60  | 114M    | 1.86M      | 55     | 29       | 10   | 56                       |
| 3     | 90  | 17.7B   | 132M       | 70     | 38       | 16   | 30                       |
| 4     | 120 | 958B    | 3.91B      | 89     | 48       | 20   | 33                       |
| 5     | 150 | 2.34T   | 9.49B      | 97     | 50       | 21   | 11                       |
| 6     | 180 | 28.1T   | 37.2B      | 100    | 53       | 23   | 8                        |

The interesting window is weeks 4 to 10, where the player buys roughly two levels a day.
From month 5 it collapses to one purchase every three or four days, income growth drops from
x1790 a month to x2-4, and the three upgrades saturate together: at day 180 their next levels
all cost 67T to 85T against a balance of 28T. There is no arbitrage left, and the additive
upgrade is dead weight (199K messages of payback against 3.9K for the bags).

The layer has to open around day 45 to 60, which is where the base tree starts to stall.

## The constraint that shapes everything

`stats.maxShells` drives **both** the Discord roles (`app/idle/shells-roles.ts:53`) and the
leaderboard sort key (`app/idle/leaderboard.ts:44`).

Two consequences:

1. **Prestige is socially free.** Wiping the balance costs no role and no rank. That is what
   makes a reset acceptable in a passive game where progress is public: nobody loses anything
   visible. This property must be preserved, not worked around.
2. **Coral therefore cannot be derived from `maxShells`**, which must never be reset. The run
   needs its own peak, `runMaxShells`, updated next to `maxShells` in
   `GameInstance.addResource` and zeroed on prestige.

### What resets, what survives

| Resets                   | Survives                                 |
| ------------------------ | ---------------------------------------- |
| `resources.shells`       | `stats.maxShells` (roles, leaderboard)   |
| All three shell upgrades | `growthRings`                            |
| `runMaxShells`           | `lastActiveAt` (passive income)          |
|                          | `resources.coral` and the coral upgrades |

Keeping the balance would make the mechanic meaningless: everything would be rebought within
the minute.

**Decided: all three shell upgrades reset**, flippers and bags included. Both multipliers exist
only to serve the otters, so leaving either one standing would carry most of the run's power
across the reset and flatten the loop.

## Adding the next resource

Coral needed almost no structural work, and the same seams will carry the one after it:

- `BaseUpgrade.costResourceId` is a per-upgrade static and `GameInstance.buyUpgrade` debits
  `this._resources[upgrade.costResourceId]`, so an upgrade priced in a new currency needs
  **no change** to `buyUpgrade`.
- `computeIncome()` loops over `Object.values(ResourceId)` grouping by `gainResourceId`, with
  the base of 10 applied only to shells, so a new `ResourceId` gets its own
  additive/multiplicative stack with no edit to the method. That stack is only useful to a
  resource earned per message, though: coral is earned in one lump at a prestige, so its
  multiplicative stack is read by `GameInstance.coralMultiplier` instead, and its entry in
  `income` stays 0.
- `/shop` derives its pages from the currencies the registry is priced in, so a new one opens
  its own aisle unprompted.
- `ResourcesJsonSchema` and the upgrades record are optional partials, so existing
  `game-instances.json` files reload unchanged. `StatsJsonSchema` is the exception, a strict
  `z.object`: a new stat must be declared optional or every existing file fails to load.

What is **not** free is display. Every price and balance has to go through `formatResource`,
and three separate places got that wrong while coral was being added.

## Coral formula

```
coral = floor(coralMultiplier x (runMaxShells / 1e6) ^ 0.26)
```

Regenerate with `tsx scripts/simulate-prestige.ts --days=730`, which drives a real
`GameInstance`, so this table is what the shipped curves produce rather than a model of them.
The player buys the cheaper coral upgrade first and prestiges as soon as the run would at least
double lifetime coral.

| #   | Day | Run length | Run peak | Otters | Coral +   | Reef | Reef mult | Polyps | Coral x |
| --- | --- | ---------- | -------- | ------ | --------- | ---- | --------- | ------ | ------- |
| 1   | 34  | 34         | 1.23M    | 29     | 1         | 1    | x2        | 0      | x1      |
| 2   | 57  | 23         | 23.1M    | 36     | 2         | 1    | x2        | 1      | x1.10   |
| 4   | 112 | 25         | 41.1B    | 67     | 19        | 2    | x4        | 4      | x1.46   |
| 7   | 194 | 24         | 3.41Qa   | 111    | 586       | 5    | x64       | 9      | x2.36   |
| 11  | 273 | 22         | 13.1Sx   | 171    | 58916     | 8    | x512      | 15     | x4.18   |
| 14  | 362 | 35         | 1.29Oc   | 220    | 1884393   | 10   | x4.10K    | 20     | x6.73   |
| 18  | 497 | 41         | 7.83De   | 281    | 193702209 | 13   | x32.8K    | 27     | x13.1   |
| 23  | 706 | 55         | 6.23e+41 | 355    | 4.70e+10  | 16   | x524K     | 35     | x28.1   |

- The first prestige lands at **day 33**, on a run peak of a round 10^6. The divisor alone
  decides that, and no upgrade can have touched it yet, so it does not move when the exponent
  does.
- The pace is **about one prestige a month**, dipping under three weeks in the mid-game, which
  reads as a recurring server event rather than a chore, then stretching back out past a month
  and a half as the layer runs out of steam.
- Each run goes further than the last (29 otters on run 1, 355 on run 23), so progress is
  visible without reading the coral counter.

### The two constants do different jobs

This is worth stating because it was not obvious, and it was measured rather than assumed.

**`CORAL_DIVISOR` decides when the layer opens, and almost nothing else.** It is a constant
factor on every payout, so lowering it shifts the entire schedule earlier without changing how
fast prestiges follow one another. Dropping it from 1e8 to 1e6 moved the first prestige from
day 48 to day 33 and left the count where it was. Reaching a coral tier always costs the
same _ratio_ of extra run peak, and that ratio is what sets the pace.

**`CORAL_EXPONENT` is the pace knob.** It decides how much further each successive coral is,
and therefore both the prestige count and the deceleration.

### The amplification exponent, and why it reframes the curves

Measured with a free reef pinned at a fixed level, over 30, 45 and 60 simulated days: the run
peak at a fixed horizon grows as **`income ^ 5.7`**. The otter tree compounds, so any flat
multiplier on income is worth far more than its face value on the peak.

This is the single most useful number in the layer, and three conclusions follow:

- A reef level is not a x2. It is a **x52 on the run peak**, or about **15 days shaved off the
  time to reach any given target**.
- After `CORAL_EXPONENT`, one reef level multiplies the coral a run pays by `2 ^ (5.7 x 0.26)`
  = **x2.8**, against a price that goes x4. The gap between 4 and 2.8 is what makes the loop
  decelerate, and it is narrower than the naive reading of the curves suggests.
- The `back` half of a run (re-reaching the previous record) obeys
  `previous run length - 15 days per reef level bought`. With about one level per prestige, it
  stays at 50 to 80 % of the run. A prestige layer built on production multipliers alone
  **cannot** make the return phase short; see the rejected head start below.

### The stability rule, found by breaking it

No single level may multiply what pays for it by more than it multiplies its own price. What
"what pays for it" means depends on which resource the upgrade gains, and the two differ by a
factor of five:

| Upgrade gains | Feedback path                      | Bound                                   | Shipped         |
| ------------- | ---------------------------------- | --------------------------------------- | --------------- |
| CORAL         | direct, undamped                   | `price > gain`                          | x1.1 against x2 |
| SHELLS        | through the otter tree, then ^0.26 | `price > gain ^ (5.7 x 0.26)` = `^1.48` | x4 against x2.8 |

Variants that broke, each one simulated:

| Variant                                                    | Result                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Reef x2 per level at a `1.5^N` cost                        | Runaway: runs collapse from 49 to 4 days, reef level 139 by day 221                                    |
| Reef x2 per level at a `2^N` cost                          | Runaway: 35 prestiges, runs down to 5 days, peak 1e113 by day 358                                      |
| Polyps with a x2 step every 5 levels                       | 19 to 22 prestiges, runs back down to 25-35 days: a step puts those levels exactly on the runaway line |
| `coral = floor((peak / 1e7) ^ 0.40)`                       | 26 prestiges, runs frozen at 9 days, pure grind                                                        |
| `coral = floor((peak / 1e9) ^ 0.34)`                       | 9 prestiges, first one at day 60, slightly slow to open                                                |
| **`floor(k x (peak / 1e6) ^ 0.26)`, reef x2, polyps x1.1** | **Shipped, table above**                                                                               |

An earlier version of this file stated the rule as `price > gain` for every upgrade. That is
correct only for the coral-gaining half; applied to the reef it is over-conservative by the
1.48 exponent, which is why the reef reads as stingy at one level per prestige.

### Choosing the exponent

Same curves, only `CORAL_EXPONENT` changes, over 730 days with the roll pinned:

| Exponent | Prestiges / 2 yr | Run lengths                                                              |
| -------- | ---------------- | ------------------------------------------------------------------------ |
| 0.22     | 15               | 36 25 37 30 26 39 38 25 39 44 46 61 69 140 71                            |
| 0.24     | 18               | 36 25 34 28 23 33 29 20 27 31 30 34 37 27 41 41 81 82                    |
| 0.25     | 21               | 36 24 33 27 21 32 27 17 24 22 26 24 28 40 28 32 53 60 ...                |
| **0.26** | **23**           | **36 24 32 27 21 21 27 16 17 21 23 23 24 18 24 27 25 44 44 51 32 48 64** |
| 0.28     | 30               | 36 24 30 25 19 24 23 14 15 18 18 19 17 14 18 18 19 ...                   |

0.26 halves the run lengths of 0.22 in the mid-game while keeping a tail that climbs back to
two months. 0.28 buys the extra prestiges by flattening that tail, which is the property worth
keeping: the layer should run out of steam slowly, leaving room for the next one.

Every exponent still dips between the first and second prestige, 36 days down to about 24. That
is inherent: the first reef level is a x2 handed to a player who had nothing.

### Prestiging too early is already punished

Same config, same horizon, only the player's patience changes. `ratio` is how much the run must
be worth relative to lifetime coral before the player pulls the trigger.

| Behaviour                                           | Prestiges | Final reef | Final multiplier | Otters on the last run |
| --------------------------------------------------- | --------- | ---------- | ---------------- | ---------------------- |
| Greedy, prestige as soon as coral > 0 (`ratio=1`)   | 12        | 11         | x86.5            | 140                    |
| Patient, waits to double lifetime coral (`ratio=2`) | 10        | 14         | x292             | 171                    |

Twice as often for three and a half times less power. The sub-linear exponent teaches the
lesson on its own, which is what makes opening the mechanic to everyone safe: a player who
prestiges too eagerly slows down but never bricks their account.

## What coral buys

A multiplicative clone of the shell tree would be a waste. The game has four systems the
player currently endures without any lever: heat, growth rings, passive income and the jackpot.
They are exactly what `simulate-idle.ts` folds into its single `--messages-per-day` input.
Coral is where they become player-facing.

| Upgrade                     | Effect                                     | Why it earns its place                                                                      |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Récif nourricier (ships)    | x2 shell income per level                  | The raw lever that drives the loop.                                                         |
| Polypes bâtisseurs (ships)  | +10 % coral per prestige, per level        | Sets the tempo of the layer, and is the cheap buy that keeps a prestige from feeling empty. |
| Marée montante              | Raises the heat ceiling or slows its decay | Rewards group conversation, which fits the bot's social purpose.                            |
| Sommeil des loutres         | Multiplies passive income                  | The only upgrade that pays while the player is away.                                        |
| Coquille millénaire (ships) | Lifts the ×2 cap on growth rings, one-shot | Turns the growth rings from a system endured into a lever; sold on the Trésors page.        |

The last two have no cousin in the shell tree, so the coral shop does not read as a second
page of the same store.

**The two shipped upgrades are deliberately different in texture.** The reef is the big-ticket
buy, x2 at a price that quadruples; the polyps are small and cheap, x1.1 at a price that
doubles. In practice the player saves for a reef level and spends the change on polyps, which is
a legible decision at every prestige rather than a coin flip between two interchangeable bars.

Without the polyps the reef alone yields 9 prestiges over two years with jagged run lengths
(49, 34, 52, 49, 44, 96, 88, 66, 131). With them it yields 12, climbing smoothly. The second
upgrade buys pace regularity, not power.

### Naming

**Decided: coral 🪸, not souls.** The mechanic was designed first and named afterwards, and the
first name did not survive the formula: "souls" says the otters convert into the currency,
while the amount comes from the run's shell peak. A player would have asked why sacrificing
otters pays out in proportion to shells.

Two ways out, and only one of them is free:

- **Rebase the payout on otter levels**, which the name would have made honest. Workable on the
  numbers, with a polynomial coral cost curve (`base x N^2`) instead of an exponential one:
  about 15 reef levels after ten prestiges, x437, comparable to the x292 the current curve
  reaches. It was rejected on incentives, not on arithmetic. Counting otters makes otters the
  objective, and by the end of a run otters are the worst buy in the game, 199K messages of
  payback against 3.9K for the bags. The mechanic would pay players to buy the dead upgrade,
  and no curve tuning fixes that.
- **Rename the currency**, which costs nothing and keeps the payout on what the player actually
  produced.

Pearls were the obvious candidate and are deliberately not used: they are reserved for a later
second resource, unrelated to prestige and probably unlocked somewhere inside it. Nacre fell
with them, being literally what a pearl is made of.

Coral works because the story matches the formula. A shell is calcium carbonate and so is a
reef, so the harvest of a run settling into the reef is why the amount tracks how much was
harvested. It also carries the one idea a prestige currency needs, a permanent structure built
across cycles, and it leaves room for the pearls later: a reef large enough eventually holds
oysters.

The unit is stored as `coral` and displayed as `N 🪸`, or "N fragments de corail" where there
is room. "Coraux" is avoided as a count.

### Scope: the reef and the polyps ship, the other two wait

**Decided.** The first batch is "Récif nourricier" and "Polypes bâtisseurs" only.

"Marée montante" and "Sommeil des loutres" are worth building, but not before heat and passive
income have been reviewed as mechanics in their own right. Both are currently tuned as fixed
constants nobody can touch, and bolting a player-facing multiplier onto them would freeze their
current shape. That review comes first, then the upgrades.

### Shapes that were built or costed, and dropped

**Nurserie du récif** (start each run with `10 x N` free otter levels, `2 x 3^N` coral) shipped
briefly and was removed. A deterministic with/without comparison showed it is a **dominated
purchase**: skipping it lands every prestige from the fifth onward earlier (day 210 against 238
at P5, 672 against 720 at P11) for the same final reef level and the same coral. The naive
buyer in the simulator takes it because it is cheap; an informed player never would. A flat
count of otter levels is worth almost nothing once the income multiplier is large, since those
levels are bought back in minutes.

**Départ lancé** (start each run with a fraction `f` of the previous run's record, in shells)
was designed, simulated and rejected on feel rather than on numbers. It is the only shape found
that shortens the return phase, and it works exactly as intended: at a leveled 1 %, 2 %, 4 %,
capped at 50 %, the share of a run spent re-reaching the previous record falls from 79 % to
25 % while run lengths keep climbing from 49 to 102 days. Its two built-in safeguards are the
cap, which keeps the return from reaching zero, and the damping (1 % to 2 % pays only x1.19
coral against a x8 price).

It was dropped because it undercuts the premise of the reset: handing back a share of what was
just sacrificed makes the sacrifice read as theatre. The frustration it solves is real, and
these numbers are kept so the trade-off can be re-opened deliberately rather than rediscovered.

**Rebasing the payout on otter levels** is covered under Naming above: rejected on incentives,
since it would pay players to buy the worst upgrade in the game.

**A fraction of the previous run's peak otter level**, granted flat, was rejected without
simulation: each run seeding the next is the feedback loop the stability rule exists to avoid.

### Polypes bâtisseurs calibration

Level N costs `2^N` coral and multiplies the prestige payout by 1.1. The curve was chosen by
sweeping the pair (gain, price growth) against the shipped reef, with the roll pinned:

| Polyps curve      | Prestiges / 2 yr | Shape                                                    |
| ----------------- | ---------------- | -------------------------------------------------------- |
| none              | 17               | Long and jagged: 40, 37, 49, 45, 36, 61, 75, 82          |
| x2 at `4^N`       | 61               | Runaway, runs flat at 6 days                             |
| x1.5 at `4^N`     | 46               | Runs collapse to 12 days, deceleration gone              |
| x1.3 at `5^N`     | 26               | Close, but only 18 levels bought in two years            |
| x1.2 at `4^N`     | 24               | Same pace, 18 levels                                     |
| **x1.1 at `2^N`** | **23**           | **Shipped: 34 levels, a purchase at nearly every reset** |

What the sweep says is that the ratio `log(gain) / log(price growth)` is the knob, not either
value alone: anything above about 0.15 compresses the layer whatever the two numbers are. The
last three rows all sit near 0.13 and land within three prestiges of each other, so the choice
between them is about **how often the player gets to buy something**, not about pace. x1.1 at
`2^N` buys the most levels of any curve at that ratio, which is why it wins.

The bottom row against the top one is the argument for having a second upgrade at all: the same
exponent with the reef alone gives 17 prestiges on runs that swing between 21 and 82 days. The
polyps buy regularity of rhythm, not power.

The shape is robust to how the player spends. Under a naive "always buy the cheapest" policy the
same curves give 22 prestiges instead of 23, with the same final levels, so the calibration does
not rely on the player optimising.

Sensitivity to activity, at the shipped curves:

| Effective msg/day | Prestiges / 2 yr | First run | Run lengths, min to max |
| ----------------- | ---------------- | --------- | ----------------------- |
| 150               | 10               | 116 days  | 32 to 116 days          |
| 300               | 19               | 59 days   | 21 to 61 days           |
| 500 (reference)   | 23               | 36 days   | 16 to 64 days           |
| 1000              | 28               | 18 days   | 10 to 67 days           |

A quiet member reaches ten prestiges in two years rather than twenty-three, and never gets far
enough into the curve to see it decelerate — their runs are still shortening at the two-year
mark. The layer opens for them too, just slowly, which is the intended read: the first coral is
gated on a shell total, not on a date.

### Coquille millénaire calibration

The growth rings reach their ×2 cap at 100 active days, and the lift is sold only from there (`unlockCondition`: seedling owned and 100 days), so a heavy player cannot buy it at day 40 when it would do nothing. The price then decides how long after day 100 an ordinary player can afford it.

The target was "around day 150". **16 coral** lands on the 4th prestige (27-28 lifetime coral), where the next reef level (level 3) and the next polyps level (level 5) cost 16 too: the player picks one of the three, a real choice rather than a formality. 32 coral would have pushed it to the 5th prestige, well past the target.

With the rings modelled and the auto-buyer taking a one-shot unlock first (`simulate-prestige.ts --days=365`):

| msg/day | 1st prestige | Cap lifted | Prestiges in a year |
| ------- | ------------ | ---------- | ------------------- |
| 100     | day 108      | day 288    | 6                   |
| 200     | day 63       | day 160    | 14                  |
| 400     | day 34       | day 118    | 20                  |

At 200 msg/day, holding the cap at ×2 for the whole year gives 11 prestiges and runs settling around 24 days; the lift gives 14 and around 18 days. Faster, not a runaway: the runs stop shortening.

It is a flat one-shot, not a curve: the effect it buys, +1 % per active day with no ceiling, already grows on its own. Past the cap the banked days pay at once, so a 120-day player jumps from ×2.00 to ×2.20. Linear rather than compound on purpose; `1.01^n` is kept aside, see [shells.md](./shells.md#growth-rings).

## Why the command has no gate

What `/prestige` does is in [commands.md](./commands.md). Why it does it that way:

**No gating.** The layer is open to everyone from the first day. The command's job is to make
the trade legible, not to withhold it, and prestiging too early costs power rather than
breaking anything, as the patience comparison above shows. The only refusal is a coral gain of
**0**, and the divisor makes that refusal the natural tutorial: nobody can reach it before
roughly a month of play.

**Two calls rather than a button** because `app/discord/interactions.ts` routes only
`APPLICATION_COMMAND`. A confirmation button would mean new routing plus a component dispatch
table, which is its own piece of work, listed under What comes after.

**Fully ephemeral**, preview and confirmation alike, like `/shop`. The design calls a prestige
a monthly server event, which argues for announcing it, so this is the decision most likely to
be revisited.

## What comes after

Shipped and live. The follow-up, in order:

1. **Review heat and passive income as mechanics**, not as constants. Both are currently
   invisible to the player and untouchable. That review is the prerequisite for "Marée
   montante" and "Sommeil des loutres".
2. **Re-check the balance against real players.** Every number here rests on
   `--messages-per-day=500`, a rough stand-in for one member sending ~100 real messages a day,
   with the old streak folded in. The simulators now model growth rings and default to 200
   (heat and passive income only), so rerun before trusting an older figure here.
   Treat the shape of the curve as sound and the exact days as indicative.
3. **The jackpot** is the fourth untouched system and has no coral upgrade proposed yet.
   Coral appears nowhere in `/leaderboard` either, which stays a shells ranking by decision
   rather than by omission.
4. **Component routing.** `app/discord/interactions.ts` handles only `APPLICATION_COMMAND`
   today, so nothing in the project can answer a button or a select menu. Adding that branch
   plus a component dispatch table would let the shop paginate on buttons instead of an option
   and `/prestige` confirm in one interaction instead of two. Both ship without it first; this
   is the upgrade that makes them feel native.
