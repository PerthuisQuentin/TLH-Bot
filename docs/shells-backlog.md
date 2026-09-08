# Shells backlog 🐚

Idea list for the shells system. No implicit priority, and nothing here is a commitment.

For what the game actually does today, see [shells.md](./shells.md) — this file only records intent.

Legend: ✅ implemented — 💡 idea — 🔜 good next step

---

## Economy & earning

### Prestige 💡

Reset your shell balance in exchange for a permanent multiplier on future earnings. Lets the economy renew itself and gives long-term players a new goal. Prestige level would be visible on the profile.

### Passive income ✅

Shells accumulate while the user is absent. Full rate (1 msg-equivalent/h) for the first 24 h, then Lorentzian decay: ×0.5 at 48 h, ×0.2 at 72 h, quasi-zero after a week. Credited on the user's next message. Uses only the user's shells income (`income.shells`, upgrades included), no heat/streak multiplier.

### Passive income boost (upgrade) 💡

New shop upgrade that multiplies the passive income rate. For example ×1.5 or ×2 on the passive shells earned during an absence. Would interact naturally with the existing formula without changing its shape.

### Daily fishing 💡

`/fish` command usable once per day, awarding a random batch of shells (high variance). Adds a daily ritual that doesn't depend on sustained activity.

### Double-gain events 💡

Limited-time periods (weekends, seasonal events) where the base earn rate is doubled. Configurable manually in the server config or via an admin command.

---

## Social interactions

### Shell gifting (`/give`) 💡

Transfer a shell amount to another server member. Introduces a gift economy and can strengthen social bonds. Could be rate-limited (max amount per day) to prevent abuse.

### Stealing / raiding (mini-game) 💡

Attempt to steal shells from another user. On success: the thief pockets a fraction. On failure: they lose shells (or get a cooldown). A risky mechanic that generates lively player interaction.

### Bet duel (`/duel`) 💡

Challenge another user to a wager. Both players stake an amount, and the winner takes the opponent's bet (or a fraction). Requires explicit acceptance from the challenged player.

---

## Server events

### Collective rush 💡

When server heat exceeds a high threshold for X consecutive minutes, everyone benefits from a gain bonus for a short period. Rewards intense activity bursts and creates a herd effect.

### Server boss 💡

Periodic (or manually triggered) event where members can pool shells together to defeat a fictional boss in exchange for a collective reward (temporary multiplier, special role, etc.).

---

## Progression & goals

### Achievements 💡

Automatically unlocked milestones: first shell earned, 10 000 cumulative shells, role reached, 7-day streak, etc. Displayable on the profile, no mechanical reward required.

### Weekly challenges 💡

Objectives renewed every week (e.g. "post 50 messages in #general", "reach ×1.8 heat"). Award bonus shells on completion.

### Enhanced streak ✅ / 💡

The streak system is implemented and visible on `/shells`. Potential future improvements:

- Optional notification when the streak is about to expire.
- Progressive streak bonus beyond 7 days (milestones at 14, 30 days).

---

## Shop & upgrades

### Cooldown reduction (upgrade) 💡

Upgrade that reduces the delay between two shell gains (currently 5 s). Makes farming faster for very active users.

### Heat contribution boost (upgrade) 💡

Upgrade that increases a user's heat contribution per message. Lets a solo user push the channel multiplier higher on their own.

### Temporary upgrades 💡

Time-limited shop items (e.g. ×1.5 on earnings for 24 h). Create a shell sink and encourage strategic purchases.

### Cosmetics 💡

Purely visual items purchasable with shells: custom emoji shown on the leaderboard, `/shells` embed color, title displayed on the profile. No mechanical impact.

---

## Administration & configuration

### Admin shells (`/admin shells`) 🔜

Admin-only commands to adjust a user's balance (fix a bug, manually reward) and configure server parameters (base rate, max multiplier, etc.).

### Season reset 💡

Option to archive the current leaderboard (snapshot) and start fresh, while keeping `maxShells` for role unlocks. Useful for servers that want competitive seasons.

### Economy logs 💡

Optional log channel receiving important transactions (shop purchase, steal, gift, role threshold crossed). Lets admins monitor for abuse.

---

## Technical

### Heat persistence 💡

Heat is in-memory only and resets on restart. Since it is an instantaneous multiplier that recovers within a couple of minutes of activity, this is acceptable. Persisting it, with the decay reconstituted from the elapsed time, would be a nice-to-have for long-running deployments.

### Global cross-server leaderboard 💡

A ranking aggregating data across all servers where the bot is present. Would require lifting the current per-guild isolation — to be considered carefully.

---

## Quiet-user friendly mechanics

The current system strongly rewards message volume. The ideas below aim to give low-activity users a meaningful path to earning shells without competing on raw post count.

### Silence multiplier 💡

The longer a user has been silent, the higher the multiplier on their next earn event. For example: no message in the last hour → ×1.5, 6 hours → ×2, 24 hours → ×3, capped at some maximum. The bonus resets after each earned message. Rewards those who speak rarely but meaningfully.

### First-message-of-the-day bonus 💡

The very first message of the calendar day (Europe/Paris timezone, consistent with the streak logic) earns a fixed shell bonus, regardless of volume. Even posting once a day is worth it. Could be displayed as a streak milestone.

### Reaction income ✅

Reacting earns the reactor 10 % of a normal message gain (heat and streak included), and the reacted message's author 10 % of _their own_ income, flat — no heat, no streak, no passive income, and their `lastActiveAt` is left alone.

Farming is bounded by the reactor's own 5-second cooldown rather than by a per-message cap, so spamming reactions cannot inflate someone else's balance. Self-reactions pay the author nothing.

Still open: no per-message cap, so a message that collects reactions from many different members keeps paying. That has not been a problem in practice.

### Off-peak bonus 💡

Invert the heat multiplier logic: messages sent when the channel is cold (heat < 0.5, multiplier ×1.0) earn a small bonus instead of a penalty. Rewards members who keep the conversation alive during quiet periods.

### Observer dividend 💡

When a channel has high heat, a fraction of the bonus shells generated is distributed to all members who have been present (sent at least one message in the last N minutes) — not just those currently active. Quiet bystanders who were part of the conversation earlier still benefit from the rush they helped ignite.

### Lucky message (jackpot) ✅

Every message carries a 1-in-1000 chance of paying ×1000 the base income, on top of the normal gain. Announced publicly.

Neither heat nor streak applies, on purpose: at equal income a jackpot is worth the same to everyone, so hitting one in a dead channel on day one pays exactly like hitting one mid-rush on a 7-day streak. The odds are per message and independent of frequency, so the lottery is the one mechanic a low-volume member competes on evenly.
