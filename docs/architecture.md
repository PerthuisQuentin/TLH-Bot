# Architecture

## Two runtimes in one process

`app.ts` boots two concurrent runtimes. Knowing which one a code path belongs to is the key to navigating the repo.

| Runtime            | Entry point                                          | Handles                                                                                                             |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Express webhook    | `POST /interactions` → `app/discord/interactions.ts` | Slash commands and component clicks. Discord signs the request; `verifyKeyMiddleware` validates the signature.      |
| discord.js gateway | `app/discord/setup.ts` → `app/discord/handlers.ts`   | `messageCreate` and `messageReactionAdd` → shell earning, role promotions, jackpot announcements, spontaneous chat. |

A third surface sits alongside them: a key-protected REST API under `/api` (`x-api-key` header) exposing per-guild data files, guild roles and message deletion. It is used by an external admin tool, not by Discord.

Slash commands never reach the gateway client, and gateway events never reach Express. The two paths share only the storage layer and the domain code.

---

## Folder structure

| Folder                | Role                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/commands/`       | One file per slash command: `{ definition, handler }`. Orchestrates and formats the Discord response.                                                      |
| `app/commons/`        | Shared helpers: prompt building, response parsing, Discord REST helpers, the in-memory cooldown cache.                                                     |
| `app/discord/`        | Gateway client, interaction dispatch, event handlers, message parsing, role application, discord.js-free shared types.                                     |
| `app/llm/`            | The backend-agnostic AI engine: prompt loop, tool rounds, memory protocol, provider selection.                                                             |
| `app/llm/openrouter/` | OpenRouter adapter, same contract, via `@openrouter/sdk`.                                                                                                  |
| `app/llm/gemini/`     | Gemini adapter: client, schema mapping, error classification.                                                                                              |
| `app/llm/tools/`      | AI-callable tools and their registry: weather.                                                                                                             |
| `app/idle/core/`      | Pure game logic: `GameInstance`, upgrades, heat, growth rings, passive income, jackpot, prestige, resources, big-number, modifier DSL. No I/O, no Discord. |
| `app/idle/handlers/`  | Turns a `DiscordEvent` into game rules and returns a plain result.                                                                                         |
| `app/idle/`           | Game persistence (`game-instance-storage.ts`), leaderboard, role thresholds.                                                                               |
| `app/routes/`         | Express REST handlers (`/api/files`, `/api/guilds`, `/api/messages`).                                                                                      |
| `app/storage/`        | The file store: RAM cache, atomic writes, zod schemas, file-type registry.                                                                                 |
| `files/`              | Per-guild persistent data (configurable via `FILES_DIR`).                                                                                                  |
| `scripts/`            | Dev and analysis scripts. Excluded from the build.                                                                                                         |

---

## Layering

```
app/routes/     parse only
    ↓
app/commands/   orchestrate + format the Discord response
    ↓
domain          app/idle/, app/llm/
    ↓
storage         app/storage/
```

Two rules hold this together:

- Domain code must not import `discord.js` or an AI SDK. `app/idle/` may import the plain type declarations in `app/discord/types.ts` (`DiscordEvent`, `PendingRoleChanges`) — those are deliberately discord.js-free.
- AI backends stay isolated one folder down, behind the `LlmProvider` interface in `app/llm/types.ts` — `app/llm/gemini/` and `app/llm/openrouter/` today, picked by `AI_PROVIDER`. Everything above it — `app/llm/*.ts` and `app/llm/tools/` — is backend-agnostic, and ESLint enforces that split by depth. New AI-callable tools go in `app/llm/tools/`.

The seam between Discord and the game lives in exactly two files. `app/discord/handlers.ts` builds a `DiscordEvent`; `app/idle/handlers/handle-event.ts` returns a plain result (`jackpot`, `pendingRoleChanges`) that the caller turns back into Discord side effects.

---

## Adding a slash command

A command is one object exported from `app/commands/<name>.ts` and listed in the `commands` array in `app/commands/index.ts`. That single array drives both dispatch (`interactions.ts` matches on `definition.name`) and registration (`commands.ts` → `npm run register`).

Handlers receive raw Express `req`/`res`, not discord.js interaction objects, and reply through the helpers in `app/commons/utils.ts`: `replyText`, `replyEmbed`, `replyDeferred`, `getOption`, `isPublicOption`, `requireGuild`. `replyComponents` sends a Components V2 message instead; that flag makes `content` and `embeds` unusable on the message for good, so a V2 reply is never mixed with the embed helpers. A command that defers answers later through `updateInteractionResponse`, also V2. `updateInteractionResponseOrLog` is the same edit for a handler's own error path, where rethrowing would have nowhere to go — see [Error handling](#error-handling).

Re-run `npm run register` after any change to a command's `definition`.

### Buttons and other components

**Prefer them to command options.** An option has to be known and typed before the command runs; a component is offered once the player can see what it acts on. So:

- **A component** for anything decided after reading the reply: confirming a destructive action, paging, sorting, picking an item from a list, choosing a quantity, sharing an ephemeral reply publicly. `/prestige` used to take `confirmer:true`; it now previews and offers a button.
- **An option** for input the command cannot start without, typed at invocation: the question of `/ask`. When a command has both, the option opens it and the components drive it from there.
- **Replies are Components V2 containers** (`Container` with an accent colour, `TextDisplay` with markdown headings, `Separator`, action rows), built with the helpers of `app/commons/components.ts` (`container`, `text`, `separator`, `actionRow`, `button`). Each command keeps its own layout; only the literal shapes are shared. There are no embed fields or footer: `### ` headings and a `-# ` line stand in for them. A command still on embeds moves to V2 when it is next reworked, not in passing.
- **Stay under the message limits** ([Discord's component reference](https://docs.discord.com/developers/components/reference)): **40 components in total** per V2 message, an action row holding up to 5 buttons or a single select, a section 1 to 3 text displays plus one accessory, a button label 80 characters, a `custom_id` 100. The reference does not say whether nested components count toward the 40, so count them all: a container, its rows and their buttons. It states no cap on the text of a Text Display. A row of buttons per list item runs out fast: put one button in a `Section` accessory and move the rarer choices to a select.

A command that draws interactive components also sets `onComponent(req, res, action)`. Each component's `custom_id` is `<command>:<action>`, built with `componentCustomId`: `interactions.ts` routes a `MESSAGE_COMPONENT` interaction to the command named by the prefix and hands it the action, and answers 400 to a `custom_id` it cannot route, like an unknown command. The command answers 400 itself to an action it never drew.

A click usually answers with `updateComponents`, which rewrites the message the component sits on (`UPDATE_MESSAGE`) rather than posting a new one. A click is a fresh interaction with its own 3-second deadline and token, so buttons keep working long after the 15 minutes of the original one. The handler must re-check the state at click time: the message is a snapshot, and the same button can be clicked twice. `/prestige` is the reference implementation.

**Sharing** replaces a `public` option. A private panel closes with `shareFooter`, whose Share button posts the panel again as a new public message (`replyComponents` without `ephemeral`), recomputed at click time and naming the sharer instead of carrying the button. Each command decides what the public copy keeps. `/leaderboard` shares a read-only snapshot with no components at all; `/heat` keeps its refresh, and a later click on it reads who shared it with `sharedByOf`, so the name survives the refresh.

Handling a click needs no `npm run register`: only command definitions are registered.

---

## Main flows

### `/ask`

```
User → /ask question:…
    ↓
POST /interactions  (signature verified by discord-interactions)
    ↓
app/discord/interactions.ts → app/commands/ask.ts
    ├── channel in noAskChannels? → ephemeral refusal
    │     (config read guarded: a normal reply is only possible before the defer)
    ├── replyDeferred()            (Discord gives 15 min from here)
    ├── REST fetch: channel name + last 50 messages
    └── app/discord/messages.ts → ConversationMessage[]
    ↓
app/llm/index.ts → app/llm/chat.ts
    ├── app/commons/prompts.ts builds system + user prompt
    │     (formatConversation renders the messages to text here, not before)
    ├── getProvider() opens a session with the declarations from app/llm/tools/
    └── loop while the model returns tool calls, up to MAX_TOOL_ROUNDS
          (last round is sent disarmed, forcing a textual answer)
    ↓
app/commons/response.ts splits on the ### [MÉMOIRE] marker
    ↓
Edit the deferred response  +  persist the memory half silently
```

Every model call leaves a trail in the logs, described in [The AI layer](#the-ai-layer).

### Shell earning (gateway)

```
messageCreate / messageReactionAdd
    ↓
app/discord/setup.ts       (try/catch: discord.js never awaits its listeners)
    ↓
app/discord/handlers.ts    builds a DiscordEvent
    ↓
app/idle/handlers/handle-event.ts
    ├── channel in noShellChannels?  → stop
    ├── updateChannelHeat            (always, even on cooldown)
    ├── 5 s per-user cooldown        → stop
    ├── one synchronous mutator:
    │     passive income → growth ring (recomputes income) → heat × activity fraction → jackpot roll
    ├── credit the reacted message's author  (reactions only)
    └── getShellsRolesConfig() → computeRoleChanges(roles, maxShells, currentRoleIds)
    ↓
back in app/discord/handlers.ts
    ├── jackpot   → generated announcement → channel.send()
    └── role change → applyRoleChanges() → generated congratulation → channel.send()
```

### Spontaneous chat (gateway)

Runs concurrently with shell earning, not after it: the two share no state, and only this
one takes a per-guild AI queue slot (announcements pass `saveMemory: false` and skip it),
so neither can block the other. Each swallows its own errors, so a failure here never
touches the economy path.

```
messageCreate
    ↓
app/discord/handlers.ts    handleMessage() → Promise.allSettled([handleEvent, maybeChatNaturally])
    ↓
app/discord/chat.ts        maybeChatNaturally()
    ├── read {guildId}-config.json → chatEnabled === false, or channel in noChatChannels?  → stop
    ├── direct @mention of the bot?              → always triggers
    ├── else message contains a chatNicknames entry?  → triggers with probability chatIndirectProbability (default 0.10)
    ├── else                                     → triggers with probability chatRandomProbability (default 0.01)
    └── no trigger → stop
    ↓
channel.messages.fetch() (discord.js cache/REST, not the raw DiscordRequest wrapper /ask uses)
    → parseMessage() per message → chronological ConversationMessage[]
    ↓
app/llm/index.ts           chatNaturally() → same chatWithLlm() engine as /ask
    (createNaturalChatInstruction instead of createQuestionInstruction; memory still saved)
    ↓
message.reply()
```

### The per-guild AI queue

Reading `{guildId}-memory.txt`, calling the model and writing the result back is one
read-modify-write whose middle step takes seconds. `fileStore.writeText` replaces the file
wholesale — it is not the read-modify-write `updateJson` offers — so two overlapping cycles
for the same guild would both start from the same snapshot and the later write would
silently discard the earlier one. Since spontaneous chat can fire unattended in any channel,
that overlap stopped being hypothetical.

`enqueueForGuild` (`app/commons/guild-queue.ts`) therefore serializes the **whole** cycle
per guild, which is why `chatWithLlm` builds the prompt itself instead of receiving one:
the memory read has to happen once the guild's turn arrives, not before. Only memory-writing
callers queue (`ask`, `chatNaturally`); announcements pass `saveMemory: false` and run
straight through, so a jackpot is never delayed by a conversation.

A rejected task rejects for its own caller — `/ask` still sees the original error object,
which is what keeps its 503 detection working — without blocking the next task for that
guild. The known cost: a hung model call holds that guild's queue until it settles.

### The AI layer

`app/llm/index.ts` is the only entry point the rest of the app knows: `ask`, `chatNaturally`, `generateRolePromotionMessage` and `generateJackpotMessage`, one file each. All of them run `chatWithLlm` (`app/llm/chat.ts`), the backend-agnostic engine: prompt building, the bounded tool loop, the memory protocol and the logs.

**Providers.** A backend is an adapter one folder down, implementing `LlmProvider` from `app/llm/types.ts`:

- `createSession({ systemPrompt, tools })` returns an `LlmSession`, which sends either the user prompt or tool results and returns an `LlmTurn`: the text, the tool calls normalized out of the SDK's shape, and `costUsd` when the API bills per request.
- `classifyError(error)` turns the SDK's failures into an `LlmErrorKind`, so `/ask` can tell an overloaded model from a broken request without reading a status code. The error itself is never wrapped: callers still see the original object.

Two adapters exist, `app/llm/gemini/` (`@google/genai`) and `app/llm/openrouter/` (`@openrouter/sdk`), each with its model in a `DEFAULT_MODEL` constant. `AI_PROVIDER` picks one; `getProvider()` resolves it from the `PROVIDERS` map in `app/llm/provider.ts`, and `app.ts` calls it once at boot so a misspelt value fails the start rather than the first `/ask`.

**Tools.** `app/llm/tools/` holds each tool as a declaration plus an `execute` that never throws: a failed lookup is an answer the model can read and work around. The registry in `app/llm/tools/index.ts` exposes the declarations and `executeToolCall`, which answers `Fonction inconnue` for a name the model invented.

Declarations speak a repo-owned vocabulary (`ToolParamType`), so the tools never import an SDK. Each adapter maps it on the way out: `toGenaiFunctionDeclaration` to genai's `Type` enum, `toOpenRouterTool` to plain JSON Schema.

`ToolCall` and `ToolResult` carry an `id` pairing a result with the call it answers. OpenAI-shaped APIs mint one per call and reject a result without it; Gemini has none and matches on the name, so its adapter puts the name there. The engine carries the id without reading it.

**The loop always ends on text.** It is bounded by `MAX_TOOL_ROUNDS`, and the last round is sent with `disarmTools: true`, which leaves the model no function to ask for. Each adapter does that its own way. Gemini sends a per-request `config` declaring no tool; that config does not inherit the chat's, so `systemInstruction` is restated in it. OpenRouter omits `tools` from the request. No caller needs an "it never converged" branch.

The memory marker the loop's final text is split on, and why its pattern is tolerant, is described with the file it feeds: [storage.md](./storage.md#guildid-memorytxt).

**Logs.** Only the engine logs; adapters never do.

```
[LLM] Tool | kind=ask | round=1 | name=get_weather | args={"city":"Paris,FR"} | guildId=…
[LLM] Done | kind=ask | provider=openrouter | model=google/gemini-3.1-flash-lite | rounds=1 | tools=1 | cost=$0.001432 | guildId=…
[LLM] Failed | kind=jackpot | provider=gemini | model=gemini-3.1-flash-lite | rounds=0 | tools=0 | guildId=…
```

- One `Tool` line per tool call, and one `Done` line per model call, or `Failed` on `console.error` just before the original error is rethrown.
- `kind` is the `LlmCallKind` the entry point passed: `ask`, `chat`, `jackpot` or `promotion`.
- `cost` is the sum of every turn's `costUsd`. The key is dropped when no turn reported one, which is always the case with Gemini.
- Prompts and replies are never logged. Tool `args` are, capped at 200 characters, since the model writes them.

---

## Gateway configuration

`app/discord/setup.ts` declares the intents and partials the event handlers depend on:

- Intents: `Guilds`, `GuildMessages`, `GuildMembers`, `DirectMessages`, `MessageContent`, `GuildMessageReactions`.
- Partials: `Message`, `Channel`, `Reaction` — reactions on messages older than the cache arrive partial and are fetched on demand in `handleReaction`.

`GuildMembers` is what makes `member.displayName` (server nickname) available on gateway events.

---

## Error handling

discord.js never awaits its listeners, and Express 5 only forwards _awaited_ async rejections to its error middleware. A floating rejection in either path is unhandled, and Node kills the process — taking both runtimes and the REST API with it.

Every entry point therefore owns a try/catch:

- Both gateway listeners in `setup.ts`.
- `handleEvent` in `handlers.ts`, with nested catches so a failed announcement never loses the shell gain.
- Each command handler that touches I/O, so exactly one reply is sent on the error path. `/ping` and `/heat` have none, and need none: both are fully synchronous and read nothing from disk, Discord or the AI.

`replyDeferred` splits a handler in two, and the halves fail differently — `/ask` is the one command that has both:

|                      | Before the defer                                                   | After it                                                                                  |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Reaching the user    | a normal reply is still possible                                   | only editing the deferred reply                                                           |
| A rejection escaping | nothing was sent, so Discord shows "L'application n'a pas répondu" | headers are already sent, so Express can do nothing and the spinner runs until it expires |

So work before the defer must be wrapped even when it looks like plain bookkeeping — reading the guild config is I/O and a malformed file throws — and the error path's own edit must swallow its failure rather than rethrow, because there is nowhere left to report it.
