# Potential features — Shells system 🐚

Brainstorming of potential features around the shells system. No implicit priority.

---

## Economy & earning

### Prestige
Reset your shell balance in exchange for a permanent multiplier on future earnings. Lets the economy renew itself and gives long-term players a new goal. Prestige level would be visible on the profile.

### Passive income (upgrade)
New shop upgrade that generates a small number of shells per hour, without requiring any messages. Encourages players to check in regularly to collect.

### Daily fishing
`/fish` command usable once per day, awarding a random batch of shells (high variance). Adds a daily ritual that doesn't depend on sustained activity.

### Double-gain events
Limited-time periods (weekends, seasonal events) where the base earn rate is doubled. Configurable manually in the server config or via an admin command.

---

## Social interactions

### Shell gifting (`/give`)
Transfer a shell amount to another server member. Introduces a gift economy and can strengthen social bonds. Could be rate-limited (max amount per day) to prevent abuse.

### Stealing / raiding (mini-game)
Attempt to steal shells from another user. On success: the thief pockets a fraction. On failure: they lose shells (or get a cooldown). A risky mechanic that generates lively player interaction.

### Bet duel (`/duel`)
Challenge another user to a wager. Both players stake an amount, and the winner takes the opponent's bet (or a fraction). Requires explicit acceptance from the challenged player.

---

## Server events

### Collective rush
When server heat exceeds a high threshold for X consecutive minutes, everyone benefits from a gain bonus for a short period. Rewards intense activity bursts and creates a herd effect.

### Server boss
Periodic (or manually triggered) event where members can pool shells together to defeat a fictional boss in exchange for a collective reward (temporary multiplier, special role, etc.).

---

## Progression & goals

### Achievements
Automatically unlocked milestones: first shell earned, 10 000 cumulative shells, role reached, 7-day streak, etc. Displayable on the profile, no mechanical reward required.

### Weekly challenges
Objectives renewed every week (e.g. "post 50 messages in #general", "reach ×1.8 heat"). Award bonus shells on completion.

### Enhanced streak
The streak system is already implemented (`app/idle/streak.ts`). Potential improvements:
- Display the streak on the `/shells` profile.
- Optional notification when the streak is about to expire.
- Progressive streak bonus beyond 7 days (milestones at 14, 30 days).

---

## Shop & upgrades

### Cooldown reduction (upgrade)
Upgrade that reduces the delay between two shell gains (currently 10 s). Makes farming faster for very active users.

### Heat contribution boost (upgrade)
Upgrade that increases a user's heat contribution per message. Lets a solo user push the channel multiplier higher on their own.

### Temporary upgrades
Time-limited shop items (e.g. ×1.5 on earnings for 24 h). Create a shell sink and encourage strategic purchases.

### Cosmetics
Purely visual items purchasable with shells: custom emoji shown on the leaderboard, `/shells` embed color, title displayed on the profile. No mechanical impact.

---

## Administration & configuration

### Admin shells (`/admin shells`)
Admin-only commands to adjust a user's balance (fix a bug, manually reward) and configure server parameters (base rate, max multiplier, etc.).

### Season reset
Option to archive the current leaderboard (snapshot) and start fresh, while keeping `maxShells` for role unlocks. Useful for servers that want competitive seasons.

### Economy logs
Optional log channel receiving important transactions (shop purchase, steal, gift, role threshold crossed). Lets admins monitor for abuse.

---

## Technical

### Heat persistence
Heat is currently in-memory only and resets on restart. Persisting it (with reconstituted decay) would avoid losses during deployments.

### Global cross-server leaderboard
A ranking aggregating data across all servers where the bot is present. Would require lifting the current per-guild isolation — to be considered carefully.
