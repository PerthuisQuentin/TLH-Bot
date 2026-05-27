# Idle shells system

The shells (🐚) system is a passive idle game built into the bot. Users earn shells by chatting, spend them on upgrades in the shop, and unlock Discord roles based on their all-time shell peak.

---

## Overview

```
Message sent
     │
     ▼
noShellChannels? ──yes──► skip
     │ no
     ▼
updateChannelHeat  ──────────────────────────► heat multiplier (×1.0–×2.0)
     │
     ▼
10 s cooldown? ──yes──► skip (heat already updated)
     │ no
     ▼
addShells(userId, guildId, multiplier)
  │
  ├── base = shellsPerMessage  (default 10, boosted by upgrades)
  ├── variance = ±10 %
  └── amount = round(rolled × multiplier)
     │
     ▼
updateMemberShellsRoles(member, maxShells)
  └── if role changed ──► generateRolePromotionMessage() ──► channel.send()
```

---

## Shell earning

### Per-message gain

Each qualifying message earns a random amount in the range `[base − variance, base + variance]`:

- `base` = `shellsPerMessage` stored in `shells.json` (default **10**)
- `variance` = `round(base × 0.1)` — i.e. ±10 %
- The rolled value is then multiplied by the **heat multiplier** for the channel.

### Cooldown

A user can earn shells at most once every **10 seconds** per server. Messages sent during the cooldown still count toward channel heat.

### Excluded channels

Channels listed in `noShellChannels` in the server config never award shells (heat is still tracked).

---

## Channel heat

Heat quantifies how lively a conversation is and converts to a shells multiplier applied to each earn event.

### Contribution model

Each user has an individual contribution score (0–5.0) for a channel:

- **+0.5** added on every message (capped at 5.0).
- Contributions **decay exponentially** over time: `c(t) = c₀ × e^(−λt)` with λ = 0.01 s⁻¹ (half-life ≈ 69 s).
- Entries below 0.01 are pruned to avoid memory leaks in inactive channels.
- State is held **in-memory only** — heat resets when the bot restarts.

### Heat formula

Raw heat is computed from all active contributions as a pairwise interaction score:

$$\text{heat} = \frac{\left(\sum c_i\right)^2 - \sum c_i^2}{2}$$

This naturally rewards diverse multi-user activity over a single spammy user.

### Heat → multiplier table

| Heat range | Multiplier | Typical situation                |
| ---------- | ---------- | -------------------------------- |
| < 0.5      | ×1.0       | Solo or just starting            |
| 0.5–2      | ×1.2       | Two users starting to chat       |
| 2–4        | ×1.4       | Moderate duo activity            |
| 4–8        | ×1.6       | Sustained duo / 4 users starting |
| 8–12       | ×1.8       | 4 active users                   |
| ≥ 12       | ×2.0       | 4+ sustained, or 8+ users        |

---

## Daily streak

Each calendar day (Europe/Paris timezone) where a user earns at least one shell batch increments their **streak**. Missing a day resets it to 1.

### Streak → multiplier table

| Streak (days) | Multiplier |
| ------------- | ---------- |
| 1             | ×1.00      |
| 2             | ×1.17      |
| 3             | ×1.33      |
| 4             | ×1.50      |
| 5             | ×1.67      |
| 6             | ×1.83      |
| **7+**        | **×2.00**  |

Formula: `1 + min(streak − 1, 6) / 6`

The streak multiplier is **combined multiplicatively** with the heat multiplier:

```
finalMultiplier = heatMultiplier × streakMultiplier
```

The theoretical maximum is ×4.0 (heat ×2.0 × streak ×2.0).

### Persistence

Streak state is stored in `{guildId}-shells.json` alongside the shell balance. Two fields are added per user:

- `streak` — current consecutive-day count (absent means 0).
- `lastStreakDate` — ISO date `YYYY-MM-DD` (Paris time) of the last qualifying day.

The update is idempotent: calling it multiple times on the same day leaves the streak unchanged. Existing users without these fields are treated as streak 0 (multiplier ×1.0 until their first earn), with no migration required.

---

## Upgrades

Upgrades increase the base `shellsPerMessage` permanently. They are purchased via `/shop` and persisted per-user per-server in `upgrades.json`.

The final `shellsPerMessage` is recomputed after every purchase:

```
shellsPerMessage = (DEFAULT + Σ additive gains) × Π multiplicative gains
```

### Upgrade kinds

| Kind             | Effect                                              |
| ---------------- | --------------------------------------------------- |
| `ADDITIVE`       | Adds shells/msg to the base (stacks with `DEFAULT`) |
| `MULTIPLICATIVE` | Multiplies the entire additive total                |

### Cost formula

Level advancement follows a **geometric series**:

$$\text{cost}(n) = \text{initialCost} \times \text{costMultiplier}^n$$

The total cost of buying `k` consecutive levels from level `n` uses the closed-form sum:

$$\text{totalCost}(n, k) = \text{initialCost} \times \text{costMultiplier}^n \times \frac{\text{costMultiplier}^k - 1}{\text{costMultiplier} - 1}$$

### Current upgrades

#### 🦦 Loutres plongeuses (`divingOtters`) — ADDITIVE

| Property               | Value    |
| ---------------------- | -------- |
| `initialCost`          | 1 000 🐚 |
| `costMultiplier`       | 1.20     |
| `baseGain`             | 1 🐚/msg |
| `gainDoublingInterval` | 10       |

Gain formula: the marginal gain of the k-th level doubles every 10 levels:

- Levels 1–10: +1 🐚/msg each → cumulative +10
- Levels 11–20: +2 🐚/msg each → cumulative +30
- Levels 21–30: +4 🐚/msg each → cumulative +70
- …

#### 🐟 Nageoires hydrodynamiques (`hydrodynamicFlippers`) — MULTIPLICATIVE

| Property         | Value     |
| ---------------- | --------- |
| `initialCost`    | 15 000 🐚 |
| `costMultiplier` | 1.25      |
| `baseGain`       | 1.15      |

Gain formula: `×1.15^level` (level 0 = ×1.0, no effect).

---

## Roles

Discord roles are awarded based on a user's **historical shell maximum** (`maxShells`), not their current balance. This means spending shells in the shop never causes a demotion.

The `shellsRoles` array in the server config maps thresholds to role IDs:

```json
"shellsRoles": [
  { "threshold": 500,   "roleId": "111..." },
  { "threshold": 2000,  "roleId": "222..." },
  { "threshold": 10000, "roleId": "333..." }
]
```

- Roles are sorted by ascending threshold.
- The highest threshold the user has reached is the **only** active role — lower ones are removed.
- When a role is gained, the bot generates a personalised congratulation message via Gemini and sends it to the channel where the promoting message was posted.
- Role config is cached in memory for **60 seconds** to reduce file I/O.

---

## Data storage

| File                      | Content                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `{guildId}-shells.json`   | Array of `ShellsUser` (`userId`, `shells`, `maxShells`, `shellsPerMessage`) |
| `{guildId}-upgrades.json` | Array of `UserUpgrades` (`userId`, `divingOtters`, `hydrodynamicFlippers`)  |

See `docs/data-storage.md` for the full file format reference.

---

## Keeping the bot's explanations up to date

The function `createUserPrompt` in `app/commons/prompts.ts` contains a hardcoded **SYSTÈME DE COQUILLAGES** block that the bot uses to answer questions about the idle game rules (multipliers, mechanics, commands, etc.).

**Whenever a rule or mechanic changes** (new multiplier, new upgrade, rebalanced formula…), that block must be updated to match the new behaviour. If it falls out of sync, the bot will give incorrect answers to users asking how the system works.
