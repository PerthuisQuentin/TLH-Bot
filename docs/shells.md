# The shells game

Shells (🐚) are a passive idle game built into the bot. Members earn them by taking part in the conversation, spend them on shop upgrades, and unlock Discord roles based on their all-time peak.

All of it lives in `app/idle/`. The pure rules are in `app/idle/core/` — no I/O, no Discord — and everything is keyed off a single aggregate.

---

## `GameInstance`

`app/idle/core/game-instance.ts` holds one player's entire state: resources (currently just `shells`), stats (currently just `maxShells`), income (currently just `shells`, derived rather than stored), growth rings, lastActiveAt and upgrade levels.

Its persistence boundary is exactly three methods — `toJson()`, `new GameInstance(json)` and `GameInstance.newInstance(userId)`. Load and save go through `app/idle/game-instance-storage.ts`; the file is `{guildId}-game-instances.json`.

**All shell arithmetic goes through `app/idle/core/big-number.ts`** (`bn`, `bnAdd`, `bnMul`, `bnGte`, `formatBigNum`, …), a thin decimal.js wrapper. Balances reach 10^30 and beyond, so a native `number` must never hold a shell value. Values are persisted as strings and rendered with idle-game suffixes (K/M/B/T/Qa/…).

---

## The earn pipeline

`app/idle/handlers/handle-event.ts`, in order:

```
1. channel in noShellChannels?          → stop
2. updateChannelHeat                    → always, even if step 3 stops the event
3. 5 s per-user cooldown                → stop
4. credit passive income since lastActiveAt
5. add the day's growth ring              → recomputes the income
6. apply heat × activity fraction
7. roll the jackpot                     → messages only
8. save
9. compute role changes from maxShells
```

Steps 4 to 8 run inside **one synchronous mutator** passed to `updateGameInstance`. That is what makes the read-modify-write atomic: the cycle never spans an `await`, so two concurrent events cannot each write back a stale snapshot.

Step 2 sits before the cooldown check on purpose. A member on cooldown still makes the channel livelier, and their message should count toward heat even though it earns them nothing.

The cooldown key is `{guildId}:{userId}:{activityType}`, so messages and reactions have separate 5-second budgets.

---

## Per-event gain

```
amount = floor(rolled × heat × activityFraction)
```

where `rolled` is a uniform integer in `[base − v, base + v]`, `base` = the player's shells income (`income.shells`, growth rings included) and `v = floor(base × 0.1)` — a ±10 % variance.

| Activity | Fraction | Who earns                                          |
| -------- | -------- | -------------------------------------------------- |
| Message  | ×1.0     | The author.                                        |
| Reaction | ×0.1     | The reactor, **and** the reacted message's author. |

The author's share is a flat 10 % of their own shells income, their growth rings included since the income carries them: no heat, no new ring, no passive income, and `lastActiveAt` is left untouched. Being reacted to is not an activity of theirs. It also rides behind the _reactor's_ cooldown, so reaction spam cannot farm someone else's balance, and it never triggers a role evaluation — only the reactor's roles are checked.

Self-reactions earn the author nothing.

---

## Channel heat

Heat measures how lively a conversation is and converts to a multiplier. It lives in `app/idle/core/heat/` and is **in-memory only** — it resets when the bot restarts.

Each member holds a contribution score per channel:

| Constant           | Value                         |
| ------------------ | ----------------------------- |
| Message increment  | +0.5                          |
| Reaction increment | +0.1                          |
| Cap per member     | 5.0                           |
| Decay λ            | 0.006 s⁻¹ (half-life ≈ 116 s) |
| Prune threshold    | 0.01                          |

Contributions decay as `c(t) = c₀ × e^(−λt)`, applied lazily on every event rather than by a background loop. Ten back-to-back messages reach the cap; with decay in between it takes more. Entries below the prune threshold are dropped on the next event in their channel.

A channel that goes dead gets no such event, so its entries would stay forever. Past `ln(cap / threshold) / λ ≈ 17 min` of silence every contribution is provably below the threshold, which makes the whole channel state indistinguishable from a fresh one — so it is dropped outright. That sweep is amortized: it runs from the next event on any channel, at most once every 5 minutes.

Raw heat combines the contributions **pairwise**:

$$\text{heat} = \frac{\left(\sum c_i\right)^2 - \sum c_i^2}{2}$$

That is the sum over unordered pairs of members. A conversation between several people therefore beats one person spamming: a lone contributor pairs with nobody and scores zero.

| Heat    | Multiplier | Typical situation                      |
| ------- | ---------- | -------------------------------------- |
| < 0.5   | ×1.0       | Solo, or just starting                 |
| 0.5 – 2 | ×1.2       | Two members starting to chat           |
| 2 – 4   | ×1.4       | Moderate duo                           |
| 4 – 8   | ×1.6       | Sustained duo, or 4 members warming up |
| 8 – 12  | ×1.8       | 4 active members                       |
| ≥ 12    | ×2.0       | 4+ sustained, or 8+ members            |

---

## Growth rings

_Stries de croissance_ for players, `growthRings` in code. `app/idle/core/growth-rings.ts` counts the Europe/Paris calendar days on which the member earned at least once. **The count never goes down**: the days need not be consecutive, and a missed day only pauses it. Shells come from showing up, not from never missing a day.

**A reaction counts.** Adding the day's ring carries no `activityType` guard: one emoji in the day is enough, even though a reaction only pays a tenth of a message. That is deliberate — the count measures showing up, and reacting still requires being on the server that day.

```
multiplier = min(1 + 0.01 × days, 2)
```

| Days       | 1     | 7     | 30    | 50    | 70    | 100+      |
| ---------- | ----- | ----- | ----- | ----- | ----- | --------- |
| Multiplier | ×1.01 | ×1.07 | ×1.30 | ×1.50 | ×1.70 | **×2.00** |

**The multiplier is part of the income.** `computeIncome` multiplies the shells income by it, so everything read off `income.shells` carries it: the message gain, passive income, the jackpot, the reacted author's share, `/shells` and the income leaderboard. Heat stays out because it moves from one message to the next; the rings move at most once a day, which makes them a property of the player, like an upgrade.

The day's ring is added, and the income recomputed, before the message is paid, so the first earning event already pays ×1.01. Adding a ring is idempotent — calling it several times the same day changes nothing.

**Why it is shaped this way.** The count is meant to reward showing up over the long run without punishing a missed day: the consecutive-day series it replaced reset on a single absence, and the switch carried each series over as its day count with no compensation, accepting that members between 7 and 100 days lost bonus. Growth is linear rather than compound: `1.01^days` was considered and kept aside, since it reaches ×37.8 at a year and ×1428 at two and would need its own cap and a check against the prestige layer, which the rings survive.

**Days keep counting past the cap.** Only the bonus stops at ×2 (`isCapped`, shown on `/shells` as `🌀 Stries de croissance : 120 jours — ×2.00 (plafond atteint)`), so the [Coquille millénaire](#the-cap-lift), which lifts it, pays the banked days at once.

Heat and growth rings combine multiplicatively, so the ceiling on a normal message is **×4.0**.

---

## Passive income

`app/idle/core/passive-income.ts` credits the shells accumulated during an absence, on the member's next earning event. It integrates a Lorentzian-decaying rate:

$$\text{rate}(H) = \begin{cases} 1 & H \leq 24 \\ \dfrac{1}{1 + \left(\frac{H - 24}{24}\right)^2} & H > 24 \end{cases}$$

which has a closed-form integral:

$$\text{shellHours}(H) = \begin{cases} H & H \leq 24 \\ 24 + 24 \arctan\!\left(\dfrac{H - 24}{24}\right) & H > 24 \end{cases}$$

The credited amount is `floor(income.shells × shellHours(H))`, where `H` is the hours since `lastActiveAt`.

`lastActiveAt` then moves to the instant that amount actually paid for, not to now. Within the 24-hour plateau the rate is constant, so the time bought is exactly `credited / income.shells` hours and the fraction the floor cut off stays owed. This matters because earning events run seconds to minutes apart: at a 10/h income one shell takes six minutes, so moving the clock to now regardless would floor every credit to zero and pay a steadily chatting member nothing at all.

Past the plateau the clock still jumps to now. Time and shells stop being interchangeable there, since rewinding by the unpaid fraction would move those minutes back to the head of the curve and have them paid again at the full rate instead of the decayed one. What is dropped is under one shell out of a payout worth hundreds.

| Absence | Hourly rate | Cumulative (base 10) |
| ------- | ----------- | -------------------- |
| 12 h    | 100 %       | ~120 🐚              |
| 24 h    | 100 %       | ~240 🐚              |
| 48 h    | 50 %        | ~428 🐚              |
| 72 h    | 20 %        | ~505 🐚              |
| 1 week  | 2.7 %       | ~577 🐚              |
| ∞       | → 0         | ~617 🐚 (cap)        |

The cap is `income.shells × (24 + 12π) ≈ 61.7 × income.shells`. The rate never actually reaches zero, so an absence always pays something — but coming back after a month is barely better than coming back after a week.

Passive income uses `income.shells`, upgrades and growth rings included, with no heat. It is credited before the day's ring is added, so an absence is paid at the rings the player had during it.

---

## Jackpot

`app/idle/core/jackpot.ts`: every **message** has a 1-in-1000 chance of paying `income.shells × 1000` **on top of** the normal gain. Reactions never roll.

Heat does not apply; the growth rings do, since they are part of the income. At equal income a jackpot is worth the same to everyone, whether they hit it in a dead channel or a packed one.

The bot announces it publicly in the channel, with a message generated by the AI model, opening and closing on 🎉 — see [Announcement markers](#announcement-markers).

---

## Upgrades

Upgrades raise a resource's income permanently and are bought with `/shop`. Each upgrade declares which resource it costs (`costResourceId`), which resource its gain contributes to (`gainResourceId`), and whether a prestige takes it back to level 0 (`resetOnPrestige`). The shells upgrades are bought and paid in `SHELLS`; the coral ones are bought with `CORAL` and survive a reset.

`GameInstance.computeIncome()` groups upgrades by `gainResourceId` first, then applies the usual additive/multiplicative split within each group:

```
income[resourceId] = (initial + Σ additive gains) × Π multiplicative gains
income[SHELLS]    ×= growthRingsMultiplier
```

where `initial` is `DEFAULT_SHELLS_PER_MESSAGE` (10) for `SHELLS` and 0 for every other resource, and the sums/products only run over upgrades whose `gainResourceId` matches. Recomputed by `computeIncome()` on load, after every purchase or prestige, and when a new growth ring is added. It is never persisted: a change to the formula applies to every player on the next load, with no migration.

### The modifier DSL

Curves are expressed declaratively in `app/idle/core/maths.ts` rather than with ad-hoc math. A **trigger** yields a stack count, an **operation** turns that count into a contribution, and the result is the additive sum times the multiplicative product.

| Trigger            | Stacks                            |
| ------------------ | --------------------------------- |
| `AT_LEVEL {level}` | 1 once `level` is reached, else 0 |
| `EVERY {interval}` | `floor(level / interval)`         |
| `RANGE {from, to}` | 1 inside the range, else 0        |

| Operation               | Contribution                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| `ADDITIVE`              | `value × stacks`, summed                                           |
| `MULTIPLICATIVE`        | `value ^ stacks`, multiplied                                       |
| `MULTIPLICATIVE_LINEAR` | `value × stacks`, multiplied — **neutral until it first triggers** |

The exception on the last row matters. `value ^ 0` is 1 and harmless, but `value × 0` is 0 and would wipe the whole product, so an untriggered linear modifier is skipped rather than applied.

### Current upgrades

Costs share one shape: `cost(n) = base × m^n × b^floor(n/10)`, where `cost(n)` is the price of going from level `n` to `n+1`.

|           | 🦦 Loutres plongeuses         | 🐟 Nageoires hydrodynamiques | 🎒 Sacs de récolte XXL |
| --------- | ----------------------------- | ---------------------------- | ---------------------- |
| id        | `divingOtters`                | `hydrodynamicFlippers`       | `harvestBags`          |
| kind      | ADDITIVE                      | MULTIPLICATIVE               | MULTIPLICATIVE         |
| base cost | 1 000 🐚                      | 15 000 🐚                    | 100 000 🐚             |
| cost `m`  | ×1.2 / level                  | ×1.3 / level                 | ×2 / level             |
| cost `b`  | ×2 / 10 levels                | ×5 / 10 levels               | ×10 / 10 levels        |
| gain      | `level × 2 × floor(level/10)` | `×1.15 ^ level`              | `×1.5 ^ level`         |

The otters' gain is the odd one out. Below level 10 it is simply `+level` 🐚/msg; from level 10 on, a **linear** factor of `2 × floor(level/10)` multiplies the whole thing, so the curve steps up at every tenth level:

| Level       | 9   | 10  | 19  | 20  | 29  | 30  | 45  | 50  |
| ----------- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gain 🐚/msg | 9   | 20  | 38  | 80  | 116 | 180 | 360 | 500 |

Buying `k` levels sums `cost(n) … cost(n+k−1)` in a loop. There is no closed form: the decade boost breaks the geometric series. The total is rounded up with `bnCeil` at the moment it is displayed and charged, so the price shown is exactly the price paid.

`getMaxBuyable` walks the levels once, accumulating their cost until the balance no longer covers the next one, and returns both the count and the total. `/shop` derives the price and the "max" hint from that single result, so they can never contradict each other.

### The unlock

|          | 🌱 Bouture de corail                |
| -------- | ----------------------------------- |
| id       | `coralSeedling`                     |
| kind     | CUSTOM                              |
| costs    | SHELLS                              |
| cost     | `CORAL_DIVISOR / 10`, today 100K 🐚 |
| maxLevel | 1                                   |

A one-shot purchase, sold for shells on the `Trésors` page, that opens the whole coral half of the game. Until it is bought, `GameInstance.coralUnlocked` is false and **coral does not exist as far as the player can see**: `/shop` has no Corail aisle button (asking for it lands on the default aisle), `/shells` drops its Récif field and omits the coral upgrades from both upgrade lists, and `/prestige` declines pointing at the shop. The AI is not kept from talking about it: since a prestige can be shared in a channel, members meet the mechanic before unlocking it, and the AI only tells them the seedling opens it.

Its price is derived from `CORAL_DIVISOR`, not written down: the door is always a tenth of the way to the room, so rebalancing the prestige threshold moves both together. Both land on round figures — 100K to open it, 1M of run peak for the first coral — because these are the two numbers a player quotes back at you.

It is `UpgradeKind.CUSTOM`, like the Coquille millénaire below. It produces nothing, so `computeIncome` — which matches ADDITIVE and MULTIPLICATIVE and falls through on anything else — skips it. Its whole effect is that its level is above 0.

**`maxLevel` is enforced in two places.** `getMaxBuyable` stops at the cap, and `GameInstance.buyUpgrade` refuses a quantity that would overshoot it rather than clamping — clamping would charge for levels the player did not get. A maxed upgrade also has to be filtered out of any auto-buy candidate list, or a cheapest-first buyer picks the price it will never be sold and stalls; `scripts/sim-common.ts` does that.

### The cap lift

|          | 🌀 Coquille millénaire                      |
| -------- | ------------------------------------------- |
| id       | `millennialShell`                           |
| kind     | CUSTOM                                      |
| costs    | CORAL, flat 16 🪸                           |
| maxLevel | 1                                           |
| unlock   | seedling owned **and** 100 growth ring days |
| page     | `Trésors`                                   |

A one-shot purchase that lifts the ×2 cap on [growth rings](#growth-rings): the multiplier becomes `1 + 0.01 × days` with no ceiling, banked days included. Kept across a prestige. `GameInstance.growthRingsCapLifted` reads its level; `growthRingsMultiplier` and `growthRingsCapped` are what callers use. Its `unlockHint` names the seedling and the 100 days, never coral, since a player without the seedling can ask for it by name. Why 16: [prestige-design.md](./prestige-design.md#coquille-millénaire-calibration).

### Coral upgrades

Bought with coral rather than shells, and **never reset by a prestige**: they are the permanent half of the game. They live on their own `/shop` aisle, Corail, which stays shut until the seedling above is bought. Coral is paid out by [Prestige](#prestige) below.

Their costs are plain geometric, with no decade boost: `cost(n) = base × m^n`.

|           | 🫧 Récif nourricier           | 🪷 Polypes bâtisseurs |
| --------- | ----------------------------- | --------------------- |
| id        | `nourishingReef`              | `buildingPolyps`      |
| kind      | MULTIPLICATIVE                | MULTIPLICATIVE        |
| gains     | SHELLS                        | CORAL                 |
| base cost | 1 🪸                          | 1 🪸                  |
| cost      | `×4 / level`, `×2 / 5 levels` | `×2 / level`          |
| gain      | `×2 / level`, `×2 / 5 levels` | `×1.1 / level`        |

The reef's levels cost 1, 4, 16, 64, 256 coral and multiply the harvest ×2, ×4, ×8, ×16, ×64. Both of its curves carry the same step every 5 levels, which is what keeps them in proportion.

The polyps' levels cost 1, 2, 4, 8, 16 coral and multiply the prestige payout by 1.1 each. They are the cheap buy, deliberately: the reef is the big-ticket item, and the polyps are what the change between two reef levels goes into. The pair is what keeps the loop from stalling: without the polyps the reef alone produces long, jagged runs and roughly half as many prestiges.

**The polyps' gain is not an income.** Coral has no per-message rate, so `computeIncome` would seed its stack at 0 and multiply nothing. The multiplicative CORAL stack is read at the one moment it applies, by `GameInstance.coralMultiplier`, which `previewPrestige` and `prestige` both go through.

#### The runaway rule

No single level may multiply what pays for it by more than it multiplies its own price. What "what pays for it" means differs by upgrade, and the difference is a factor of five:

- **Gaining CORAL** (the polyps) is a direct loop: a level multiplies coral by `g` and must cost more than `g` per level. 1.1 against ×2 is a wide margin, which is why the polyps carry no step.
- **Gaining SHELLS** (the reef) goes through the otter tree first, and the tree amplifies. Measured at a fixed horizon, the run peak grows as `income^5.7`, so a reef level worth ×2 of income is worth ×52 of run peak and, after `CORAL_EXPONENT`, ×2.6 of coral. The bound is `price > gain^(5.7 × CORAL_EXPONENT)`, that is `gain^1.25`: ×4 against ×2.6 per level.

The rule is per level, not on average. A step on the gain alone breaks it at every step, and the simulated loop collapses from 30-day runs to 10-day ones. The calibration and the failed variants are in [prestige-design.md](./prestige-design.md).

The walk stops at `MAX_LEVELS_PER_PURCHASE` (1000), which also bounds a single purchase. That ceiling is out of reach for every curve in the game — 1000 levels of the cheapest upgrade cost 10^113 shells — and exists for a curve that would not be exponential: a flat cost of 1000 against a 10^30 balance means 10^27 affordable levels, and a scan with no ceiling would never come back.

### Adding an upgrade

1. Subclass `BaseUpgrade` in `core/upgrades/`, declaring `static readonly id / kind / costResourceId / gainResourceId / displayName / emoji / description / resetOnPrestige / shopPage` (the base class reads metadata off the constructor) and implementing `computeCost`, `computeGain`, `computeFormatGain`. `resetOnPrestige` is required rather than defaulted, so the question cannot be skipped; the typecheck refuses the registry entry until it is answered.
2. Add the `UpgradeId` enum member in `core/types.ts` (and a `ResourceId` member too, if the upgrade costs or boosts a resource that doesn't exist yet).
3. Register the class in `core/upgrades/upgrade-registry.ts`.
4. Optionally, `static readonly unlockCondition` (a pure function of an `UnlockContext`, the player's upgrade levels) and `unlockHint` (French, what opens it). Without a condition the upgrade is always on sale.

`/shop`, `/shells`, `GameInstance` and `scripts/analyze-upgrade.ts` all iterate the registry, so nothing else needs editing. `/shop` puts the upgrade on the page its `shopPage` declares, which is independent of the currency it costs.

**Whether an upgrade can be seen and bought is decided by the upgrade.** `isUnlocked` reads its `unlockCondition`, and `isVisible` adds "not maxed". `GameInstance.isUpgradeUnlocked` / `isUpgradeVisible` hand it the player's state, and `buyUpgrade` refuses a locked upgrade, so no caller (the shop, the sandbox, the simulations) can buy what the player cannot see. The shop only renders the answer. The reef and the polyps are locked on `isCoralUnlocked`, which `coral-seedling.ts` owns, as does `GameInstance.coralUnlocked`.

**Write every price and balance with `formatResource(amount, resourceId)`** from `core/resources.ts`, never `formatBigNum` plus a literal 🐚. The literal reads fine and is wrong the moment the value is not shells: that is how `/shop`, `analyze-upgrade.ts` and the shop pricing lines the AI reads each ended up quoting coral prices in shells.

---

## Prestige

Trades the current run for **coral**, the permanent currency spent on the upgrades above. Run with `/prestige`, which previews the trade and performs it on a confirmation button.

```
coral = floor(coralMultiplier × (runMaxShells / CORAL_DIVISOR) ^ CORAL_EXPONENT)
```

with `CORAL_DIVISOR = 1e6` and `CORAL_EXPONENT = 0.26`, both in `core/prestige/prestige-config.ts`, and `coralMultiplier` the product of the coral-gaining upgrades (today, the polyps).

**The two constants do different jobs.** The divisor is the price of the first coral and therefore what gates the first prestige, about a month in for an active member — no upgrade can have touched it yet, so that threshold is the same whatever the exponent is. It is a round 10^6 on purpose: it is the one figure a player reads off a refusal, and the seedling prices itself at a tenth of it. Because it is a constant factor on every payout, changing it slides the whole schedule earlier or later without changing how fast prestiges follow one another: at 1e8 the first prestige lands on day 48 and at 1e6 on day 33, for the same number of prestiges per year either way.

The exponent is the pace knob. It is sub-linear on purpose — a run held twice as long pays far less than twice the coral, so waiting has diminishing returns and prestiging early costs power rather than breaking anything — and how far below 1 it sits decides how fast the layer decelerates. The lower it is, the more run peak each further coral costs and the longer runs get. At 0.26 an active member reaches about 23 prestiges in two years, on runs that shorten from a month to a fortnight and then climb back past two months; at 0.22 they reach 15, at 0.28 they reach 30.

The multiplier sits **inside** the floor. Multiplying a floored payout would throw away exactly the fraction the polyps are bought for. It also lowers the first threshold, since it takes less run peak to reach one coral.

| Reset by a prestige                        | Untouched                                        |
| ------------------------------------------ | ------------------------------------------------ |
| `resources.shells`                         | `stats.maxShells`                                |
| Every upgrade with `resetOnPrestige: true` | Every upgrade with `resetOnPrestige: false`      |
| `stats.runMaxShells`                       | `growthRings`, `lastActiveAt`, `resources.coral` |

**The payout reads `runMaxShells`, not the balance and not `maxShells`.** A peak rather than the balance, so spending on upgrades — the whole game — does not reduce what the run is worth. A per-run peak rather than the all-time one, because `maxShells` never decreases: paying on it would let a player prestige again immediately for the same run, and it cannot be reset since the roles and the leaderboard read it.

That last point is what makes a reset socially free: **no role is lost and no rank moves**, which is the property the whole mechanic rests on.

**The layer is gated on 🌱 Bouture de corail.** `GameInstance.previewPrestige()` folds the unlock into `canPrestige`, so a caller that reads only that field cannot offer a trade the layer would refuse; the separate `unlocked` flag is there for the two callers that word the two refusals differently.

`GameInstance.prestige()` does the trade synchronously and returns `null` without touching anything when the run pays no coral, or when the layer is still locked. Coral is spent afterwards, in the shop, so a level bought now only pays from the next run on.

**Quote the trade through `GameInstance.previewPrestige()`, never through the bare `previewPrestige(peak, multiplier)`.** The free function takes the multiplier as a required argument precisely so a caller cannot forget it; the method is the one that already knows the answer.

The calibration, the failed variants and why the currency is coral rather than souls: [prestige-design.md](./prestige-design.md).

---

## Roles

Discord roles are awarded from `maxShells`, the **all-time peak**, never the current balance. Spending in the shop can therefore never demote anyone.

`shellsRoles` in the guild config maps thresholds to role IDs:

```json
"shellsRoles": [
  { "threshold": "500",   "roleId": "111..." },
  { "threshold": "2000",  "roleId": "222..." },
  { "threshold": "10000", "roleId": "333..." }
]
```

- Roles are sorted by ascending threshold, parsed with `bnFromJSON`.
- The highest threshold reached is the **only** active role; lower ones are removed.
- Only ids listed in `shellsRoles` are ever touched, so a member's unrelated roles survive a promotion.
- `app/idle/shells-roles.ts` computes the change as a plain `PendingRoleChanges`; `app/discord/roles.ts` applies it. The domain never touches discord.js.
- On promotion, the AI model generates a personalised congratulation posted to the channel that triggered it, opening and closing on 🏅 — see [Announcement markers](#announcement-markers).

In `shells-roles.ts`, `getShellsRolesConfig` is the only async function and the only place the sort happens; `roleForShells`, `nextRoleAfter` and `computeRoleChanges` are synchronous and take that sorted list. They rely on the ordering — both walk the list and stop early — so pass them the loader's output, not a raw `config.shellsRoles`.

No separate config cache: the store already keeps the config file in RAM.

---

## Announcement markers

The bot posts two kinds of unsolicited announcement in a channel, both written by the AI model and both congratulatory. One reserved emoji per kind keeps them tellable apart at a glance:

| Announcement   | Marker | Instruction builder              |
| -------------- | ------ | -------------------------------- |
| Jackpot        | 🎉     | `createJackpotInstruction`       |
| Role promotion | 🏅     | `createRolePromotionInstruction` |

Each prompt asks for its own marker to open and close the message, and explicitly forbids the other one — a model told only "be enthusiastic" reaches for 🎉 on both. The hardcoded fallback used when the model fails or returns nothing carries the same marker, so a failure never produces the one announcement that cannot be identified.

Reserving a third marker means adding it to both prompts, since each one names what it must avoid.

---

## Keeping the bot's own explanation in sync

`createUserPrompt` in `app/commons/prompts.ts` embeds a hardcoded **SYSTÈME DE COQUILLAGES** block that the bot reads out when a member asks how the game works.

**Update it whenever a mechanic changes** — rates, multipliers, upgrades, commands. If it drifts, the bot confidently describes its own rules wrongly, and nothing in the build will catch it.
