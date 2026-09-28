# Next ideas

Working notes on what could follow the prestige and growth rings reworks (#65 to #69). Intent only: for what the game does today, see [shells.md](./shells.md).

Retained: sponsorship, then achievements with small boosts. The first-message bonus still has to be weighed against passive income.

## Context

Growth rings climb to ×2 at day 100 and are part of the income, so a newcomer starts far behind the veterans. Several ideas below aim at that gap.

## Sponsorship (parrainage)

Preferred track. It helps newcomers catch up and rewards whoever brings them in. It replaces the `/give` idea.

**Draft v1**

- A newcomer picks a sponsor once (`/parrain @member`), within their first N days on the server.
- The sponsored player gets a temporary starting boost, to offset the rings gap (×1 against ×2).
- The sponsor earns a percentage of the sponsored player's gains, taken from nobody. It lasts a limited time, or until the sponsored player reaches a role.
- Like the author's share on reactions, this gain feeds neither the sponsor's passive income nor their rings.

**Abuse**

- Main risk: sponsoring one's own alt accounts.
- Counter: a capped duration, and a sponsor gain proportional to the sponsored player's real activity.
- To consider: a minimum Discord account age.

**Open questions**

- Does the link survive the sponsor's or the sponsored player's prestige?
- Sponsored players per sponsor: unlimited or capped?
- Public announcement when the link is made?
- Values: duration N, starting boost, sponsor share. Simulate before fixing them.

## Achievements with small boosts

Milestones that unlock automatically: first prestige, 100 days of rings, a jackpot, a role reached. Beyond display, a small boost can smooth the slow passages of the curve.

- Find the slow passages first with the `scripts/` simulations: time between two roles, time before the first prestige. Place achievements there.
- Does a boost survive prestige? If yes, it is a permanent multiplier in the income, like the rings, and weighs on the long run.
- Where they show: `/shells` profile.

## First message of the day bonus

A fixed bonus on the first message of the calendar day (Europe/Paris, like the rings).

- Large overlap with passive income: a player back after a day already gets about 24 message-equivalents, credited on that same first message. A once-a-day player would be paid twice for the same thing.
- Hard to reason about on paper; measure it in the sandbox (`npm run sandbox`) before deciding.

## Dropped

- **Admin shells commands**: not needed.
- **`/give`**: replaced by sponsorship.
- **Shell sink before prestige**: based on a wrong premise. The three otter upgrades have no level cap, so shells always have somewhere to go.
