# Commands

Discord slash commands. Definitions live in `app/commands/<name>.ts` and are pushed to Discord with `npm run register` — re-run it after any change to a `definition`.

Every user-facing string is French. The option names below are the literal ones Discord shows.

| Command        | Options                  | Scope        | Default visibility |
| -------------- | ------------------------ | ------------ | ------------------ |
| `/ping`        | —                        | Guilds + DMs | public             |
| `/ask`         | `question`               | Guilds + DMs | public             |
| `/leaderboard` | `page`, `sort`, `public` | Guilds + DMs | ephemeral          |
| `/shells`      | `user`, `public`         | Guilds + DMs | ephemeral          |
| `/shop`        | `upgrade`, `quantity`    | Guilds only  | always ephemeral   |
| `/heat`        | `public`                 | Guilds only  | ephemeral          |

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
4. Calls Gemini with the tool declarations from `app/tools/`, looping while the model returns tool calls, bounded by `MAX_TOOL_ROUNDS`. The last round declares no tool, so a model that will not converge still produces an answer rather than running until the interaction expires.
5. Splits the response on the `### [MÉMOIRE]` marker, matched loosely (see `docs/storage.md`): the first half is posted, the second is persisted silently.

| Tool          | Triggered by       | Action                      |
| ------------- | ------------------ | --------------------------- |
| `get_weather` | A weather question | Calls World Weather Online. |

The rendering of the conversation to text happens in `app/commons/prompts.ts`, not in the command. Members are identified by Discord ID; a globally unique handle is added only when two different IDs share a display name in the same conversation.

Names come from the gateway's member cache, so the history shows server nicknames — the same names `/shells` and the gateway announcements use. REST message payloads carry no member object, which is why the cache is consulted rather than the payload; a member the gateway never saw falls back to their global name. The question header reads the same resolver as the history, so the asker is never named two different ways in one prompt.

---

## `/leaderboard`

The guild's shells ranking, 10 per page.

| Option   | Type        | Required | Description                                                                    |
| -------- | ----------- | -------- | ------------------------------------------------------------------------------ |
| `page`   | Integer ≥ 1 | No       | Page number. Default 1, clamped to the last page.                              |
| `sort`   | Choice      | No       | `max` (all-time record, default), `current` (balance), `income` (per message). |
| `public` | Boolean     | No       | Show to everyone. Default false.                                               |

Each line shows the rank, the member, their record, and their balance and income in parentheses. The requester's own line is bold; if they are not on the displayed page, it is appended below a separator, or "Non classé" if they have never earned.

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
- **Coquillages** — balance, gain per message (±10 %), gain per reaction, current streak and its multiplier.
- **Upgrades** — one line per upgrade with its level and current effect.

The all-time maximum appears in the footer only when it differs from the balance.

Roles are read from `maxShells`, so the "current role" never regresses after a shop purchase.

---

## `/shop`

Browses the upgrade shop, or buys levels. Always ephemeral.

| Option     | Type        | Required | Description                           |
| ---------- | ----------- | -------- | ------------------------------------- |
| `upgrade`  | Choice      | No       | Which upgrade to buy. Omit to browse. |
| `quantity` | Integer ≥ 1 | No       | How many levels. Default 1.           |

**Browsing** lists every upgrade with its level, current effect, next-level price, and how many levels the balance covers and for how much.

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
