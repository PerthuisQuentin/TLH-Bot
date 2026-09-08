# The shells game

Shells (🐚) are a passive idle game built into the bot. Members earn them by taking part in the conversation, spend them on shop upgrades, and unlock Discord roles based on their all-time peak.

All of it lives in `app/idle/`. The pure rules are in `app/idle/core/` — no I/O, no Discord — and everything is keyed off a single aggregate.

---

## `GameInstance`

`app/idle/core/game-instance.ts` holds one player's entire state: resources (currently just `shells`), stats (currently just `maxShells`), income (currently just `shells`), streak, lastActiveAt and upgrade levels.

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
5. update the streak
6. apply heat × streak × activity fraction
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
amount = floor(rolled × heat × streak × activityFraction)
```

where `rolled` is a uniform integer in `[base − v, base + v]`, `base` = the player's shells income (`income.shells`) and `v = floor(base × 0.1)` — a ±10 % variance.

| Activity | Fraction | Who earns                                          |
| -------- | -------- | -------------------------------------------------- |
| Message  | ×1.0     | The author.                                        |
| Reaction | ×0.1     | The reactor, **and** the reacted message's author. |

The author's share is a flat 10 % of their own shells income: no heat, no streak, no passive income, and `lastActiveAt` is left untouched. Being reacted to is not an activity of theirs. It also rides behind the _reactor's_ cooldown, so reaction spam cannot farm someone else's balance, and it never triggers a role evaluation — only the reactor's roles are checked.

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

## Daily streak

`app/idle/core/streak.ts` counts consecutive Europe/Paris calendar days on which the member earned at least once. A missed day sends the series back to 1 on the next earning event.

**A reaction counts.** The streak update carries no `activityType` guard: one emoji in the day is enough to keep the series alive, even though a reaction only pays a tenth of a message. That is deliberate — the series measures showing up, and reacting still requires being on the server that day.

```
multiplier = 1 + min(max(streak − 1, 0), 6) / 6
```

| Streak     | 1     | 2     | 3     | 4     | 5     | 6     | 7+        |
| ---------- | ----- | ----- | ----- | ----- | ----- | ----- | --------- |
| Multiplier | ×1.00 | ×1.17 | ×1.33 | ×1.50 | ×1.67 | ×1.83 | **×2.00** |

The update is idempotent — calling it several times the same day changes nothing.

Heat and streak combine multiplicatively, so the ceiling on a normal message is **×4.0**.

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

Passive income uses `income.shells` alone, upgrades included, with no heat and no streak.

---

## Jackpot

`app/idle/core/jackpot.ts`: every **message** has a 1-in-1000 chance of paying `income.shells × 1000` **on top of** the normal gain. Reactions never roll.

Neither heat nor streak applies. That is deliberate: at equal income, a jackpot is worth the same to everyone, whether they hit it in a dead channel on day one or in a packed channel on a 7-day streak.

The bot announces it publicly in the channel, with a message generated by Gemini, opening and closing on 🎉 — see [Announcement markers](#announcement-markers).

---

## Upgrades

Upgrades raise a resource's income permanently and are bought with `/shop`. Each upgrade declares which resource it costs (`costResourceId`) and which resource its gain contributes to (`gainResourceId`) — both are `SHELLS` for every upgrade today, the only member of the `ResourceId` enum so far.

`GameInstance.computeIncome()` groups upgrades by `gainResourceId` first, then applies the usual additive/multiplicative split within each group:

```
income[resourceId] = (initial + Σ additive gains) × Π multiplicative gains
```

where `initial` is `DEFAULT_SHELLS_PER_MESSAGE` (10) for `SHELLS` and 0 for every other resource, and the sums/products only run over upgrades whose `gainResourceId` matches. With a single resource in play, this reduces to the same formula as before. Recomputed by `computeIncome()` after every purchase.

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

The walk stops at `MAX_LEVELS_PER_PURCHASE` (1000), which also bounds a single purchase. That ceiling is out of reach for every curve in the game — 1000 levels of the cheapest upgrade cost 10^113 shells — and exists for a curve that would not be exponential: a flat cost of 1000 against a 10^30 balance means 10^27 affordable levels, and a scan with no ceiling would never come back.

### Adding an upgrade

1. Subclass `BaseUpgrade` in `core/upgrades/`, declaring `static readonly id / kind / costResourceId / gainResourceId / displayName / emoji / description` (the base class reads metadata off the constructor) and implementing `computeCost`, `computeGain`, `computeFormatGain`.
2. Add the `UpgradeId` enum member in `core/types.ts` (and a `ResourceId` member too, if the upgrade costs or boosts a resource that doesn't exist yet).
3. Register the class in `core/upgrades/upgrade-registry.ts`.

`/shop`, `/shells`, `GameInstance` and `scripts/analyze-upgrade.ts` all iterate the registry, so nothing else needs editing.

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
- On promotion, Gemini generates a personalised congratulation posted to the channel that triggered it, opening and closing on 🏅 — see [Announcement markers](#announcement-markers).

In `shells-roles.ts`, `getShellsRolesConfig` is the only async function and the only place the sort happens; `roleForShells`, `nextRoleAfter` and `computeRoleChanges` are synchronous and take that sorted list. They rely on the ordering — both walk the list and stop early — so pass them the loader's output, not a raw `config.shellsRoles`.

No separate config cache: the store already keeps the config file in RAM.

---

## Announcement markers

The bot posts two kinds of unsolicited announcement in a channel, both written by Gemini and both congratulatory. One reserved emoji per kind keeps them tellable apart at a glance:

| Announcement   | Marker | Instruction builder              |
| -------------- | ------ | -------------------------------- |
| Jackpot        | 🎉     | `createJackpotInstruction`       |
| Role promotion | 🏅     | `createRolePromotionInstruction` |

Each prompt asks for its own marker to open and close the message, and explicitly forbids the other one — a model told only "be enthusiastic" reaches for 🎉 on both. The hardcoded fallback used when Gemini fails or returns nothing carries the same marker, so a failure never produces the one announcement that cannot be identified.

Reserving a third marker means adding it to both prompts, since each one names what it must avoid.

---

## Keeping the bot's own explanation in sync

`createUserPrompt` in `app/commons/prompts.ts` embeds a hardcoded **SYSTÈME DE COQUILLAGES** block that the bot reads out when a member asks how the game works.

**Update it whenever a mechanic changes** — rates, multipliers, upgrades, commands. If it drifts, the bot confidently describes its own rules wrongly, and nothing in the build will catch it.
