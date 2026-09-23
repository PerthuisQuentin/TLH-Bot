# Commands

Discord slash commands. Definitions live in `app/commands/<name>.ts` and are pushed to Discord with `npm run register` — re-run it after any change to a `definition`.

Every user-facing string is French. The option names below are the literal ones Discord shows.

| Command        | Options                       | Scope        | Default visibility |
| -------------- | ----------------------------- | ------------ | ------------------ |
| `/ping`        | —                             | Guilds + DMs | public             |
| `/ask`         | `question`                    | Guilds + DMs | public             |
| `/leaderboard` | `page`, `sort`, `public`      | Guilds + DMs | ephemeral          |
| `/shells`      | `user`, `public`              | Guilds + DMs | ephemeral          |
| `/shop`        | `upgrade`, `page`, `quantity` | Guilds only  | always ephemeral   |
| `/heat`        | `public`                      | Guilds only  | ephemeral          |
| `/prestige`    | `confirmer`                   | Guilds only  | always ephemeral   |

The three shells commands that accept `public` default to an ephemeral reply, so checking your own profile doesn't spam the channel. Pass `public:true` to show it to everyone.

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

| Tool          | Triggered by       | Action                      |
| ------------- | ------------------ | --------------------------- |
| `get_weather` | A weather question | Calls World Weather Online. |

The rendering of the conversation to text happens in `app/commons/prompts.ts`, not in the command. Members are identified by Discord ID; a globally unique handle is added only when two different IDs share a display name in the same conversation.

Names come from the gateway's member cache, so the history shows server nicknames — the same names `/shells` and the gateway announcements use. REST message payloads carry no member object, which is why the cache is consulted rather than the payload; a member the gateway never saw falls back to their global name. The question header reads the same resolver as the history, so the asker is never named two different ways in one prompt.

---

## `/leaderboard`

The guild's shells ranking, 10 per page.

| Option   | Type        | Required | Description                                                                                                |
| -------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `page`   | Integer ≥ 1 | No       | Page number. Default 1, clamped to the last page.                                                          |
| `sort`   | Choice      | No       | `max` (all-time record, default), `current` (balance), `income` (per message), `rings` (growth ring days). |
| `public` | Boolean     | No       | Show to everyone. Default false.                                                                           |

Each line shows the rank, the member, their record, and their balance and income in parentheses. Under `rings` the line leads with what is ranked instead: the growth ring days, the effective multiplier (above ×2 with the Coquille millénaire), then the record. Ring ties are frequent, so they are broken by record. The requester's own line is bold; if they are not on the displayed page, it is appended below a separator, or "Non classé" if they have never earned.

The footer carries the page, the participant count and the active sort. Mentions are suppressed, so nobody gets pinged by the ranking.

---

## `/shells`

A member's shells profile.

| Option   | Type    | Required | Description                               |
| -------- | ------- | -------- | ----------------------------------------- |
| `user`   | User    | No       | Whose profile. Defaults to the requester. |
| `public` | Boolean | No       | Show to everyone. Default false.          |

Three fields:

- **Rôles** — leaderboard rank, current role, next role and the shells still missing.
- **Coquillages** — balance, gain per message (±10 %), gain per reaction, current growth rings (_Stries de croissance_) and their multiplier.
- **Récif** — coral balance, prestige count and what `/prestige` would pay. **Absent entirely** until 🌱 Bouture de corail is bought: an empty heading would announce the mechanic as loudly as its contents.
- **Upgrades** — one line per upgrade with its level and current effect. The coral ones are omitted while the layer is locked, and **one-shot unlocks never appear at all**, bought or not: their level is a yes/no, and a "Niv. 0" among levelled upgrades reads as one the player is behind on. `/shop` is where they are sold, and the assistant still prices them from `upgradeShopLines`.

The all-time maximum appears in the footer only when it differs from the balance.

Roles are read from `maxShells`, so the "current role" never regresses after a shop purchase.

---

## `/shop`

Browses the upgrade shop, or buys levels. Always ephemeral.

| Option     | Type        | Required | Description                                   |
| ---------- | ----------- | -------- | --------------------------------------------- |
| `upgrade`  | Choice      | No       | Which upgrade to buy. Omit to browse.         |
| `page`     | Choice      | No       | Which aisle to browse. Default `Coquillages`. |
| `quantity` | Integer ≥ 1 | No       | How many levels. Default 1.                   |

**Browsing** lists the upgrades of one page with their level, current effect, next-level price, and how many levels the balance covers and for how much.

**Pages** are declared by each upgrade (`shopPage`) and derived from the registry, so a page can mix currencies and one nothing is sold on never opens: `Coquillages` holds the three otter upgrades, `Trésors` the one-shot unlocks whatever they cost (🌱 Bouture de corail, priced in shells), `Corail` the two permanent ones. The page names live in `app/idle/core/shop-pages.ts`, so `/prestige` can point at the right one.

**The `Corail` page is sealed** until that seedling is bought. It replies with a door — no fields, no balance, no 🪸 anywhere — naming the upgrade that opens it. The page choice stays in the command definition either way, since choices are registered globally and cannot vary per player. While sealed, the shells page also stops listing `Corail` under "Autres rayons", and buying a coral upgrade by name is refused without quoting its price.

**What is on sale is the upgrade's call, not the shop's.** A page lists the upgrades the player may see: unlocked (its `unlockCondition`, see [shells.md](./shells.md#adding-an-upgrade)) and not maxed. A one-shot the player already owns therefore leaves the aisle entirely, rather than sitting there with a price `buyUpgrade` would refuse. "Autres rayons" lists only pages with something on sale. Buying a locked upgrade by name is refused before any price is quoted, with the upgrade's own `unlockHint`; buying a maxed one again is refused rather than reported as no funds. The page sets the list and the header, which shows the balance of every currency priced on it, nothing else, and an unknown value falls back to the default rather than erroring. `page` does not restrict `upgrade`: any upgrade can be bought by name from anywhere. A new upgrade lands on the page it declares with no edit to the command; a new page needs a display name in `shop-pages.ts` and a re-register, since the choices change. A page whose upgrades are all bought, like `Trésors` after the seedling, stays a valid choice and says there is nothing to sell.

Pages are an option rather than buttons because `app/discord/interactions.ts` routes only `APPLICATION_COMMAND`; there is no component handling in the project yet.

**Buying** runs the affordability check and the debit inside a single synchronous mutator, so a shell gain landing mid-purchase cannot let the check pass and the debit fail. Four outcomes:

| Outcome                                  | Reply                                                           |
| ---------------------------------------- | --------------------------------------------------------------- |
| `quantity` not a positive integer        | Asks for a positive integer.                                    |
| Cannot afford one level                  | The next-level price and the current balance.                   |
| `quantity` above what the balance covers | The maximum affordable count.                                   |
| Bought                                   | Old → new level, total cost, old → new gain, remaining balance. |

The first row is unreachable through Discord, which enforces `min_value: 1` itself; it guards against a malformed payload. `GameInstance.buyUpgrade` throws a `RangeError` on the same condition, since below 1 the cost sum is empty: a 0 would be a free no-op purchase reported as a success, a negative one would refund shells and lower the level. It throws just the same above `MAX_LEVELS_PER_PURCHASE` (1000 levels), so summing a caller-supplied count cannot become a long loop inside the storage mutator; a player never sees it, since anything that large exceeds what the balance covers and gets the third row instead.

The purchase is flushed to disk before the confirmation is sent — the player is told it happened, so it must not ride the 1-second write delay.

Prices are rounded up once, at the point where they are both displayed and charged, so the price shown is exactly the price paid.

The `upgrade` choices are generated from the upgrade registry, so adding an upgrade needs no edit here.

---

## `/heat`

The channel's current conversation heat.

| Option   | Type    | Required | Description                      |
| -------- | ------- | -------- | -------------------------------- |
| `public` | Boolean | No       | Show to everyone. Default false. |

Renders a 12-block progress bar, the raw heat value, the resulting multiplier and the active contributors with their contribution and relative share. The embed colour scales with the multiplier: green → yellow → orange → red.

The bar saturates at heat 7, while the ×2.0 bucket only starts at 12 — so a full bar does not mean a maxed multiplier. The number next to it is the one that matters.

Heat is in-memory only, so a fresh restart shows a cold channel.

---

## `/prestige`

Trades the current run for coral. Always ephemeral.

| Option      | Type    | Required | Description                                                   |
| ----------- | ------- | -------- | ------------------------------------------------------------- |
| `confirmer` | Boolean | No       | Performs the reset. Without it, the command only previews it. |

Every reply is an embed, refusals included, so the command looks the same whatever it answers. The locked refusal is the one exception to the 🪸 title: it carries the seedling's 🌱 instead, since naming the currency is exactly what it is avoiding.

**Two calls on purpose.** Without `confirmer`, the command shows what the trade would be and changes nothing; with `confirmer:true` it performs it. Nobody wipes a run by typing the command out of curiosity. It is two interactions rather than a confirmation button because `app/discord/interactions.ts` routes only `APPLICATION_COMMAND` and the project has no component handling.

**The preview** states the run's peak harvest and the coral it converts to, what is lost (the shells balance and every upgrade whose `resetOnPrestige` is true) and what is kept (the all-time record, roles, growth rings, coral and the coral upgrades). The two upgrade lists are split on `resetOnPrestige`, so a new upgrade lands in the right column with no edit here.

The copy leads with the conversion on purpose: the harvest feeds the reef, and the payout is read from the **peak** of the cycle rather than the balance, so spending in the shop never costs coral. Said explicitly, because the opposite assumption would make players hoard.

The coral multiplier from the polyps is quoted on its own line, and only once it is above 1, so a player who has never bought one sees no dead line. Both branches read `GameInstance.previewPrestige()`, which applies it: quoting the bare formula would under-promise a payout the confirmation then beats.

**Both branches refuse** in two cases. Without 🌱 Bouture de corail the reply names that upgrade and says nothing about coral at all, because the player has not met the currency yet. With it, below one coral, the reply names what the run peak still misses. Beyond those two, the layer is open to everyone: prestiging too early costs power rather than breaking anything.

| Outcome           | Reply                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Layer locked      | Points at 🌱 Bouture de corail in `/shop page:Trésors`, for either branch. |
| Run pays no coral | The shells the run peak still needs, for either branch.                    |
| No `confirmer`    | The preview above.                                                         |
| `confirmer:true`  | Coral gained, new coral balance, starting otter level, and new income.     |

The reset runs inside a single synchronous mutator, so a shell gain landing mid-prestige cannot slip between reading the run peak and wiping it, and it is flushed to disk before the confirmation is sent.

**No role synchronisation is involved.** Roles are computed from `maxShells`, which a prestige never touches, and only `app/discord/handlers.ts` applies them anyway — the webhook runtime this command lives in has no gateway client.
