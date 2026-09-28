# Commands

Discord slash commands. Definitions live in `app/commands/<name>.ts` and are pushed to Discord with `npm run register` — re-run it after any change to a `definition`.

Every user-facing string is French. The option names below are the literal ones Discord shows.

New interactions favour buttons and selects on the reply over options: see [Buttons and other components](architecture.md#buttons-and-other-components). Every command follows it. The one option left, `question` on `/ask`, is input the command cannot start without.

| Command        | Options    | Scope        | Default visibility         |
| -------------- | ---------- | ------------ | -------------------------- |
| `/ping`        | —          | Guilds + DMs | public                     |
| `/ask`         | `question` | Guilds + DMs | public                     |
| `/leaderboard` | —          | Guilds + DMs | ephemeral, sharable        |
| `/shells`      | —          | Guilds + DMs | ephemeral, sharable        |
| `/shop`        | —          | Guilds only  | always ephemeral           |
| `/heat`        | —          | Guilds only  | ephemeral, sharable        |
| `/prestige`    | —          | Guilds only  | ephemeral, result sharable |

Replies are ephemeral, so checking your own numbers doesn't spam the channel.

**📢 Partager** replaces that option on the commands moved to components: the private panel ends with a small line carrying the button, and a click posts the panel again as a new public message, recomputed at click time. The public copy names who shared it on that same line and has no Share button. What else it keeps is per command: a shared ranking is a read-only snapshot, a shared heat keeps its refresh. Deciding to share comes after seeing the result, which an option asked for before.

---

## `/ping`

Checks that the bot answers. No options. Replies `Pong !`.

---

## `/ask`

Asks the AI a question, with the channel's recent conversation, the guild memory and the guild system prompt as context.

| Option     | Type   | Required | Description   |
| ---------- | ------ | -------- | ------------- |
| `question` | String | Yes      | The question. |

1. Refuses if the channel is in `noAskChannels`, or if that config could not be read at all.
2. Defers the reply, which buys 15 minutes. Everything after this point can only reach the user by editing that reply — see the defer boundary in [architecture.md](./architecture.md#error-handling).
3. Fetches the channel name and its last 50 messages over REST, parsed into `ConversationMessage[]` by `app/discord/messages.ts`.
4. Calls the configured AI backend (`AI_PROVIDER`) with the tool declarations from `app/llm/tools/`, looping while the model returns tool calls, bounded by `MAX_TOOL_ROUNDS`. The last round is sent with the tools disarmed, so a model that will not converge still produces an answer rather than running until the interaction expires.
5. Splits the response on the `### [MÉMOIRE]` marker, matched loosely (see `docs/storage.md`): the first half is posted, the second is persisted silently.

| Tool                  | Triggered by                         | Action                                                           |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `get_weather`         | A weather question                   | Calls World Weather Online.                                      |
| `get_shells_profile`  | A question about one member's shells | Same data as `/shells`, plus the shop prices of their upgrades.  |
| `get_leaderboard`     | A question about the ranking         | Same data as `/leaderboard`, with an optional member line added. |
| `get_role_thresholds` | A question about roles in general    | Lists the role thresholds, read against `maxShells`.             |

The rendering of the conversation to text happens in `app/commons/prompts.ts`, not in the command. Members are identified by Discord ID; a globally unique handle is added only when two different IDs share a display name in the same conversation.

Names come from the gateway's member cache, so the history shows server nicknames — the same names `/shells` and the gateway announcements use. REST message payloads carry no member object, which is why the cache is consulted rather than the payload; a member the gateway never saw falls back to their global name. The question header reads the same resolver as the history, so the asker is never named two different ways in one prompt.

---

## `/leaderboard`

The guild's shells ranking, 10 per page. No options.

It opens on page 1, sorted by all-time record. From there the reply drives itself. The sort select heads the panel and doubles as its title ("Classement par record historique"), right above the ranking it orders. A row of five buttons closes it, so nothing sits between the select and the list: ⏮ first page, ◀ previous, the current page as a greyed-out `2/4`, ▶ next, ⏭ last, the ones leading nowhere greyed out. A page select was the other candidate, but Discord puts buttons and a select on separate rows, so it would have stacked a second navigation row under the arrows. Switching the sort goes back to page 1: `max` (all-time record), `current` (balance), `income` (per message, growth rings included), `rings` (growth ring days). The buttons carry the page and sort they lead to in their `custom_id`, so every click recomputes the ranking as it stands.

**Sharing** posts the page and sort being viewed as a **read-only snapshot**: the sharer's line bolded, the sort named in a heading since there is no select left to show it, and the page, the count, when it was computed and who shared it on the small line. No buttons, so nobody can page a ranking others are reading, and every click the command receives comes from a private panel and rewrites it in place. A reader who wants to browse runs `/leaderboard` themselves.

A navigable shared ranking was built first and dropped: the sharer paged it in place for everyone while anyone else got a private copy, which worked but was hard to predict from the reader's side, and hung on Discord reporting who had shared the message.

Each line shows the rank, the member, their record, and their balance and income in parentheses. Under `rings` the line leads with what is ranked instead: the growth ring days, the effective multiplier (above ×2 with the Coquille millénaire), then the record. Ring ties are frequent, so they are broken by record. The requester's own line is bold; if they are not on the displayed page, it is appended below a separator, or "Non classé" if they have never earned.

A small line under the ranking carries the participant count and when it was computed, as a relative Discord timestamp. Mentions are suppressed, so nobody gets pinged by the ranking.

---

## `/shells`

A member's shells profile. No options: it always opens on your own, and the panel's **👤 Voir le profil de…** select switches to anyone else in place. A `user` option to open straight on someone else was dropped to keep a single way in; looking someone up costs one pick in the select.

The header names the member beside their avatar: the server one if they set it, else their account one, else the default Discord gives an account without one. Then the blocks:

- **Rôles** — leaderboard rank, current role, next role and the shells still missing.
- **Coquillages** — balance, gain per message (±10 %, growth rings included), gain per reaction, current growth rings (_Stries de croissance_) and their multiplier. Once the 🐙 Pieuvre intendante has a level, a last line gives its switch and what it manages.
- **Récif** — coral balance, prestige count and what `/prestige` would pay. **Absent entirely** until 🌱 Bouture de corail is bought: an empty heading would announce the mechanic as loudly as its contents.
- **Upgrades** — one line per upgrade with its level and current effect. The coral ones are omitted while the layer is locked, and **one-shot unlocks never appear at all**, bought or not: their level is a yes/no, and a "Niv. 0" among levelled upgrades reads as one the player is behind on. A levelled upgrade with a cap, the 🐙 Pieuvre intendante, leaves the list once maxed. `/shop` is where they are sold, and the assistant still prices them from `upgradeShopLines`.

The small line closing the panel gives when the profile was computed, preceded by the all-time maximum only when it differs from the balance, and carries **📢 Partager**, which posts a read-only snapshot like `/leaderboard`'s. Under it:

- **🔄 Rafraîchir** recomputes the profile shown, in place. Balances move with every message.
- **🏪 Boutique**, on your own profile, opens the shop on the Coquillages aisle in a new private message.
- **🪸 Prestige**, on your own profile once the reef is open, opens the `/prestige` preview in a new private message, leaving the profile where it is.
- **🐙 Couper / Activer l’automatisation**, on your own profile once the Pieuvre intendante has a level, flips your auto-buy switch and redraws the profile in place. The change is flushed to disk first, since the redraw tells you it happened. A click on someone else's profile, from a forged id, is refused, and so is one without the Pieuvre, in words that name nothing behind the seedling.
- **👤 Voir le profil de…**, the select above.

A click brings no avatar, so Refresh, Share and the automation switch carry the profile they act on in their `custom_id`, as `<userId>:<avatar ref>`: one letter for the source, then the hash (`app/discord/avatars.ts`). A member who changes avatar in between shows the old one until the next `/shells` or pick in the select, which read it afresh. Fetching it from the API on each click was the alternative, rejected for the latency it adds inside Discord's 3 seconds and the failure path it opens.

Roles are read from `maxShells`, so the "current role" never regresses after a shop purchase.

---

## `/shop`

Browses the upgrade shop and buys levels, all by button. Always ephemeral. No options.

It opens on the `Coquillages` aisle. The panel reads top to bottom:

- **Header**: the aisle's name, then the balance of every currency priced on it.
- **Banner**, after a click to buy: what was bought, or why not.
- **One block per upgrade**: its level, description and gain now → next level, then its buy buttons.
- **Aisle row**: one button per aisle with something on sale, the current one greyed out, and 🔄 to recompute prices after earning.

**Buying** is a click on `×1`, `×10` or `Max`, each labelled with its price. `×1` and `×10` buy exactly that many and are greyed out when the balance does not cover them, rather than silently buying fewer. `×10` is left out when fewer than ten levels remain, as on the Pieuvre intendante's three: its price would add up levels past the cap. `Max` buys as many levels as the balance covers **at click time**, which can beat the count on its label if the balance grew in between. A one-shot unlock has a single `Acheter` button. The click rewrites the shop in place: new balances and prices, and the banner.

| Outcome                             | Banner                                                         |
| ----------------------------------- | -------------------------------------------------------------- |
| Bought                              | ✅ upgrade, old → new level, total cost, old → new gain.       |
| Cannot afford one level             | ❌ the next-level price and the current balance.               |
| `×10` above what the balance covers | ❌ how many levels the balance does cover.                     |
| Locked                              | ❌ the upgrade's own `unlockHint`, before any price is quoted. |
| Maxed                               | ❌ already at its maximum.                                     |

The check and the debit run inside a single synchronous mutator, so a shell gain landing mid-purchase cannot let the check pass and the debit fail; `Max` is resolved there too. The purchase is flushed to disk before the shop is redrawn, since the player is told it happened. Prices are rounded up once, where they are both displayed and charged, so the price shown is the price paid. `GameInstance.buyUpgrade` still throws a `RangeError` below 1 or above `MAX_LEVELS_PER_PURCHASE` (1000 levels); the buttons only ever send 1, 10 or a count the balance covers.

**Aisles** are declared by each upgrade (`shopPage`) and derived from the registry: `Coquillages` holds the three otter upgrades, `Trésors` the unlocks whatever they cost (🌱 Bouture de corail priced in shells, 🌀 Coquille millénaire and 🐙 Pieuvre intendante in coral), `Corail` the two permanent ones. Their names live in `app/idle/core/shop-pages.ts`, so `/prestige` can point at the right one.

**What is on sale is the upgrade's call, not the shop's.** An aisle lists the upgrades the player may see: unlocked (its `unlockCondition`, see [shells.md](./shells.md#adding-an-upgrade)) and not maxed. A one-shot the player already owns therefore leaves the aisle entirely. An aisle with nothing on sale gets no button, so the `Corail` one only appears once the seedling is bought, and `Trésors` disappears once it is empty; if the player is already on it, it stays, saying there is nothing to sell. Asking for the coral aisle while it is locked, from a stale button or a shortcut, lands on the default aisle instead, and so does the redraw after a refused coral purchase: the aisle's title and its 🪸 never show to a locked player.

**Shortcuts.** 🏪 Boutique buttons open the shop on a given aisle in a new private message (`shop:open:<aisle>`), leaving their own message in place: on your own `/shells` profile (Coquillages), on the `/prestige` refusal for a player without the seedling (Trésors), and on the prestige result (Corail).

**The component budget.** A Discord message holds 40 components. Each upgrade costs 5 (a text, a row, three buttons; 3 for a one-shot) and the frame about 7, so an aisle tops out around six or seven upgrades. The `add-upgrade` skill says so.

The options `upgrade`, `page` and `quantity` are gone: a choice made after seeing the prices is a button, and the shortcuts cover opening an aisle directly. So is the sealed door the coral page used to show, which no button leads to any more.

---

## `/heat`

The channel's current conversation heat. No options.

Renders a 12-block progress bar, the raw heat value, the resulting multiplier and the active contributors with their contribution and relative share. The container's accent colour scales with the multiplier: green → yellow → orange → red. Contributors are listed by mention without being pinged.

A small line gives when the reading was taken, and a **🔄 Rafraîchir** button rewrites the panel in place with the heat as it is now. Anyone may click it, on a shared reply too: heat belongs to the channel, not to whoever ran the command, so there is no one else's view to protect. A refreshed shared panel keeps naming its sharer.

The bar saturates at heat 7, while the ×2.0 bucket only starts at 12 — so a full bar does not mean a maxed multiplier. The number next to it is the one that matters.

Heat is in-memory only, so a fresh restart shows a cold channel.

---

## `/prestige`

Trades the current run for coral. Always ephemeral. No options. The **🪸 Prestige** button of your own `/shells` profile opens the same preview (`prestige:open`).

Every reply is a Components V2 container in the same colour, refusals included, so the command looks the same whatever it answers. The locked refusal is the one exception to the 🪸 title: it carries the seedling's 🌱 instead, since naming the currency is exactly what it is avoiding.

**Preview, then a button.** The command only shows what the trade would be and changes nothing, so nobody wipes a run by typing it out of curiosity. The preview ends with two buttons: **Confirmer le prestige** performs the trade, **Annuler** changes nothing. Either click rewrites the preview in place, and the buttons disappear with it.

A click is judged on the state at click time, not on the preview: a player who earned shells in between gets the larger payout, and a second click on the same preview meets an empty run peak and is refused. There is no owner check, since the preview is ephemeral and a click only ever acts on the clicker's own instance.

**The preview** states the run's peak harvest and the coral it converts to, what is lost (the shells balance and every upgrade whose `resetOnPrestige` is true) and what is kept (the all-time record, roles, growth rings, coral and the coral upgrades). The two upgrade lists are split on `resetOnPrestige`, so a new upgrade lands in the right column with no edit here.

The copy leads with the conversion on purpose: the harvest feeds the reef, and the payout is read from the **peak** of the cycle rather than the balance, so spending in the shop never costs coral. Said explicitly, because the opposite assumption would make players hoard.

The coral multiplier from the polyps is quoted on its own line, and only once it is above 1, so a player who has never bought one sees no dead line. Both branches read `GameInstance.previewPrestige()`, which applies it: quoting the bare formula would under-promise a payout the confirmation then beats.

**The preview and the confirm click both refuse** in two cases. Without 🌱 Bouture de corail the reply names that upgrade and says nothing about coral at all, because the player has not met the currency yet. With it, below one coral, the reply names what the run peak still misses. Beyond those two, the layer is open to everyone: prestiging too early costs power rather than breaking anything.

| Outcome           | Reply                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Layer locked      | Points at 🌱 Bouture de corail, with a 🏪 Boutique button to the Trésors aisle, for either step.                      |
| Run pays no coral | The shells the run peak still needs, for either step.                                                                 |
| `/prestige`       | The preview above, with its two buttons.                                                                              |
| Confirm click     | Coral gained, new coral balance, starting otter level, and new income, with a 🏪 Boutique button to the Corail aisle. |
| Cancel click      | Says nothing changed.                                                                                                 |
| Share click       | A public line: who prestiged, which prestige, the coral it paid.                                                      |

The reset runs inside a single synchronous mutator, so a shell gain landing mid-prestige cannot slip between reading the run peak and wiping it, and it is flushed to disk before the confirmation is sent.

**Sharing the result** posts one public line, `@x a fait son Prestige 2 : le récif gagne 36 🪸`: the event, not the private summary, so no balance goes public. The trade is already done by then, so the button carries the prestige number and the coral in its `custom_id` rather than recomputing them. This deliberately lets coral and prestige be seen by members who have not unlocked them yet: a shared prestige is a milestone worth showing, and the secrecy only ever held while nobody talked about it.

**No role synchronisation is involved.** Roles are computed from `maxShells`, which a prestige never touches, and only `app/discord/handlers.ts` applies them anyway — the webhook runtime this command lives in has no gateway client.
