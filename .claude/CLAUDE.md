# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach

- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## What this project is

TLH Bot is a multi-server Discord bot in TypeScript. It combines an AI assistant (Google Gemini), a passive gamification system (shells 🐚) and weather queries. Every Discord server gets its own isolated configuration, AI memory and data — guild ID is the partition key throughout, and nothing is shared between servers.

Two properties shape most of the code:

- **The gamification is passive.** Shells are earned automatically from message and reaction activity, never through a command. `/shells`, `/leaderboard` and `/shop` only read or spend what activity produced. Role promotions key off `maxShells` (all-time peak), never the current balance.
- **The structure is by business domain, not by technical layer.** `commands/`, `idle/`, `tools/`, `storage/` each own a slice of behaviour end to end.

## Commands

```bash
npm run dev            # tsx watch app.ts — dev server with auto-reload
npm run build          # tsc → dist/
npm start              # node dist/app.js (production entry, see Procfile)
npm run register       # push slash command definitions to Discord (run after any change to a command's `definition`)
npm run register:local # same, with TLS verification disabled (corporate proxy)
npx tsc --noEmit       # typecheck only
npm run lint           # eslint, type-aware
npm run lint:fix       # same, applying the safe fixes
npm run format         # prettier --write over **/*.{ts,js,md}
npm run format:check   # same, read-only (for CI)
npm test               # vitest run — single pass, no watch
npm run test:watch     # vitest, interactive
npm run coverage       # vitest run --coverage — full-project %, see vitest.config.ts
```

The four automated checks are `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npm test` — run them after any non-trivial change. All four must come back clean; there are no known-failing files to ignore.

`npm run register` reports what it did: on success it names the commands Discord now holds (the `PUT` is a full replacement, so that list _is_ the new state), and it exits non-zero on a missing `APP_ID` or a definition Discord refuses. The exit code is meaningful, so it is safe to chain on.

Tests sit next to what they cover: `foo.test.ts` beside `foo.ts`, explicit imports from `'vitest'` (no `globals: true`). Coverage is densest where the rules are — `app/idle/core/` is pure logic with no I/O, Discord or AI, so a test there inherits the layering rules below for free — and thinnest on what only a live external service would exercise: `app/ollama/` (unwired), `app/tools/weather.ts`, the gateway wiring in `app/discord/setup.ts`. Run `npm run coverage` for the file-by-file numbers rather than trusting a list written here. `tsconfig.build.json` excludes `**/*.test.ts`, same treatment as `scripts/`. `vitest.config.ts`'s `coverage.include` is set explicitly (`app/**/*.ts`) so untouched files show up as 0 % instead of silently disappearing from the report.

ESLint runs `typescript-eslint`'s **type-checked** preset — slower, but it's what makes `no-floating-promises`/`no-misused-promises`/`no-unnecessary-type-assertion` work. Three rules are tuned in `eslint.config.js`, reasons inline: `require-await` off (`Command.handler` is typed `async` even with nothing to await), `restrict-template-expressions` allows `decimal.js` (full-precision logging), `**/*.js` drops type-checking (outside `tsconfig.json`).

Prettier owns formatting, including Markdown — `eslint-config-prettier` is loaded last so no ESLint rule fights it. `.prettierignore` keeps it away from `package.json` (npm reindents it back) and from the game data checked in at the root (`shells.json`, `config.json`, `files/`).

Not lint-enforced: the full `routes → commands → domain → storage` ordering (only the domain/AI-SDK and `core/`-purity import rules are), and "named exports only". This file is the source of truth for both.

Two tsconfigs on purpose: `tsconfig.json` covers everything (including `scripts/`) for the editor and `tsc --noEmit`; `tsconfig.build.json` (used by `npm run build`) excludes `scripts/` so it never reaches `dist/`. `exclude` replaces rather than merges through `extends`, hence the repeated list.

`tsconfig.json` excludes nothing but `node_modules` and `dist`. Keep it that way rather than widening the exclusion to silence a script.

Simulation/analysis scripts run directly with tsx:

```bash
tsx scripts/analyze-upgrade.ts divingOtters 1 40 --base-spm=10
tsx scripts/migrate-game-instances.ts                              # dry run, add --apply to write
tsx scripts/simulate-heat.ts
tsx scripts/simulate-idle.ts --days=365 --messages-per-day=500     # msg/day absorbs heat/streak/passive
```

`npm run dev` needs a populated `.env` (`DISCORD_TOKEN`, `APP_ID`, `PUBLIC_KEY`, `GOOGLE_API_KEY`, `WEATHER_API_KEY`; optional `API_KEY`, `PORT`, `FILES_DIR`) — see `docs/configuration.md`.

## Architecture

`app.ts` boots **two concurrent runtimes** in one process; knowing which one a code path belongs to is the key to navigating this repo:

| Runtime                   | Entry                                                | Handles                                                                        |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Express webhook           | `POST /interactions` → `app/discord/interactions.ts` | slash commands (Discord signs the request; `verifyKeyMiddleware` validates it) |
| discord.js gateway client | `app/discord/setup.ts` → `app/discord/handlers.ts`   | `messageCreate` / `messageReactionAdd` → shell earning, role promotions        |

Plus a key-protected REST API under `/api` (`x-api-key` header) exposing per-guild data files, guild roles and message deletion — used by an external admin surface, not by Discord.

### Slash command registration

A command is one object (`{ definition, handler }`) exported from `app/commands/<name>.ts` and listed in the `commands` array in `app/commands/index.ts`. That single array drives both dispatch (`interactions.ts` matches on `definition.name`) and registration (`commands.ts` → `npm run register`). Adding a command means: new file, add to the array, run `npm run register`.

Handlers receive raw Express `req`/`res` (not discord.js interaction objects) and reply through the helpers in `app/commons/utils.ts` (`replyText`, `replyEmbed`, `replyDeferred`, `getOption`, `isPublicOption`, `requireGuild`). A command that defers answers later through `updateInteractionResponse`, the project's one Components V2 path — that flag makes `content` and `embeds` unusable, so it stays separate from the reply helpers. Its `…OrLog` twin is for one call only, a handler's own error path past the defer, where a rethrow has nowhere left to go; see the defer boundary in `docs/architecture.md`.

### Layering

`app/routes/` (parse only) → `app/commands/` (orchestrate + format Discord response) → domain (`app/idle/`, `app/tools/`) → storage (`app/storage/`).

The goal is that a feature's core behaviour can be read, reasoned about and changed without touching any Discord- or AI-specific code. What each layer may know:

- **Route handlers** (`app/routes/`) parse the request and delegate. No logic.
- **Command handlers** (`app/commands/`) orchestrate: load data, call domain logic, format a reply. They know Discord's inputs and outputs, but not how data is stored or how the AI is called.
- **Domain** (`app/idle/`, `app/tools/`) holds the actual rules and must not import `discord.js`, `@google/genai` or `ollama` — enforced by `eslint.config.js`'s `no-restricted-imports` for `app/idle/**`/`app/tools/**`, so a violation fails `npm run lint`. `app/idle/` may still import the _type-only_ declarations in `app/discord/types.ts` (`DiscordEvent`, `PendingRoleChanges`) — discord.js-free and erased at emit, so no runtime edge. **`app/idle/core/` is stricter: nothing outside `core/`**, npm packages aside — two `no-restricted-imports` blocks (depth-dependent, since `../` reaches further from a subfolder). Checkable post-build:
    ```bash
    # Both quote styles on purpose: tsc rewrites relative specifiers with double quotes
    # but leaves package ones as written, so matching only one silently passes.
    grep -rhoE "from ['\"][^'\"]*['\"]" dist/app/idle/core --include='*.js' | grep -vE "from ['\"]\."
    # only decimal.js and zod may appear
    ```
    Watch for enums: `import type` vanishes at emit, but an enum is a _value_ — importing one is a real runtime dependency. That's why `ChannelActivityType` lives in `app/idle/core/types.ts`, imported by the Discord adapter, not the reverse.
- **AI adapters** (`app/gemini/`, `app/ollama/`) contain everything specific to one backend. Switching models must not require an edit outside these folders. New AI-callable tools go in `app/tools/`.
- **Tool schemas speak a repo-owned vocabulary, not the SDK's.** Gemini's function-calling `type` field is a real `Type` enum — importing it into `app/tools/` would violate the same rule as importing the client. `app/tools/types.ts` defines `ToolParamType` instead; `app/gemini/ask-gemini.ts` alone maps it to genai's `Type` via `toGenaiFunctionDeclaration`. Ollama needs no mapping — its schema is plain lowercase strings already.

Named exports only is the other convention with no linter behind it: a stray `export default` shows up in review or not at all.

The test when adding a feature: _if Discord were replaced by another interface — a REST API, a CLI — would the business logic have to change?_ If yes, the separation is wrong.

The seam between Discord and the game lives in two files: `app/discord/handlers.ts` builds a `DiscordEvent` and hands it to `app/idle/handlers/handle-event.ts`, which returns a plain result (`jackpot`, `pendingRoleChanges`) that the caller turns back into Discord side effects (role changes, channel messages).

### Persistence

All state is flat files under `files/`, named `{guildId}-{fileType}.{txt|json}`, accessed **only** through `app/storage/` (the `fileStore` singleton). Guild ID is the partition key; nothing is shared between servers.

Files are held in RAM and the in-RAM copy is authoritative while dirty. `StoredFile` (`storage/stored-file.ts`) owns one file's state; `FileStore` (`storage/file-store.ts`) owns the map and the idle sweeper, started from `app.ts` via `startFileStore()`.

**`app.ts` owns the only shutdown path** — deliberate, since a second signal handler racing it is how `process.exit` lands before the disk write does. On `SIGTERM`/`SIGINT` it stops intake first (HTTP server, gateway client), then `stopFileStore()` flushes. Each teardown step is bounded and swallows its own error, so a stuck step can't eat the grace period or skip the flush behind it. Never register a signal handler anywhere else.

Two containers sharing `files/` corrupt each other: each holds whole files in RAM up to `staleAfterMs` and rewrites them entirely on flush, so an old instance can overwrite what a new one earned. Stop the old container before starting the new one.

- `fileStore.updateJson(guildId, type, mutate)` is the **only** correct way to change a JSON file — `mutate` must be synchronous, which is what makes read-modify-write atomic. `readJson` then `writeJson` reintroduces the lost-update race.
- `readJson` returns the live in-RAM object. Treat it as read-only.
- `updateJson` is write-behind (`flushDelayMs`, 1 s from the first pending change, so a steady stream can't postpone it). `writeJson`/`writeText` await the disk (REST writes). `fileStore.flush(guildId, type)` forces it elsewhere (e.g. `/shop` after a purchase).
- A clean copy older than `staleAfterMs` (60 s) is re-read (out-of-band edits); untouched for `idleAfterMs` (2 min), it's swept from RAM. **Neither happens while dirty.**
- Writes go to a `.tmp` sibling then `rename`, so a reader never sees a partial file.

Adding a file type means touching four coupled spots, all in `storage/types.ts`: `AllowedFiles`, `JsonFileTypeMap` (or the `TEXT_FILES` set), `JSON_DEFAULTS`, and `JSON_SCHEMAS` (zod, used by the REST write route).

Missing JSON files are not errors: reads fall back to `JSON_DEFAULTS`. Missing **text** files reject with `ENOENT` on purpose, because callers (`prompts.ts`) rely on it to apply their own fallback.

### The shells game (`app/idle/`)

Everything is keyed off `GameInstance` (`app/idle/core/game-instance.ts`): resources (`Record<ResourceId, BigNum>`, `SHELLS` only for now), stats (`{ maxShells }`, more counters expected), income (same shape as resources), streak, lastActiveAt, upgrade levels — `toJson()` / `new GameInstance(json)` / `GameInstance.newInstance(userId)` is the only persistence boundary. Load/save via `app/idle/game-instance-storage.ts`; file is `{guildId}-game-instances.json`.

**Reading and writing a player are different types.** `getGameInstance` / `getAllGameInstances` return a `ReadonlyGameInstance` (`core/game-instance.ts`): a `GameInstance` with every mutator removed, and a `ReadonlyStreak` in place of the live `Streak`. The copy they hand out is detached from what is persisted, so a mutation on it would change RAM and reach no file — the type is what makes that unwritable instead of silently lost. To change a player, `updateGameInstance(guildId, userId, mutate)`, mutating **inside** the callback: `mutate` must stay synchronous (that is what makes the read-modify-write atomic), the instance must not escape it, and a change the player is told succeeded needs a `flushGameInstances(guildId)` behind it. Same shape one level down: `instance.upgrades[id]` is a `ReadonlyUpgrade`, and `addLevels` exists for `buyUpgrade` alone.

**All shell arithmetic goes through `app/idle/core/big-number.ts`** (`bn`, `bnAdd`, `bnMul`, `bnGte`, `formatBigNum`, …), a thin decimal.js wrapper — balances reach 10^30+, so a native `number` must never hold one. Persisted as strings, rendered with `formatBigNum` (K/M/B/T/Qa/… suffixes).

Earn pipeline (`app/idle/handlers/handle-event.ts`), in order: skip `noShellChannels` → update channel heat (always, even on cooldown) → 5 s per-user cooldown → credit passive income since `lastActiveAt` → apply `heat × streak × activityTypeFraction` → roll jackpot (messages only, 1/1000 at ×1000) → save → compute role changes.

- **Heat** (`core/heat/`) is per-channel, **in-memory only** (resets on restart): exponentially-decaying per-user contributions combined pairwise so several talkers beat one spammer, bucketed to a ×1.0–×2.0 multiplier.
- **Streak** (`core/streak.ts`) counts consecutive Europe/Paris calendar days, ×1.00 → ×2.00 over 7 days.
- **Passive income** (`core/passive-income.ts`) integrates a Lorentzian-decaying rate: full rate for 24 h, then tapering, capped around 61.7 × `income[SHELLS]`.
- **Roles** (`shells-roles.ts`) are evaluated against `maxShells` (all-time peak), never the current balance, so spending in the shop can't demote anyone.

**Adding an upgrade**: subclass `BaseUpgrade` in `core/upgrades/`, declaring `static readonly id/kind/costResourceId/gainResourceId/displayName/emoji/description` and implementing `computeCost`/`computeGain`/`computeFormatGain`. `costResourceId`/`gainResourceId` name the `ResourceId` it's bought with and boosts — `computeIncome()` groups upgrades by `gainResourceId` before the additive/multiplicative split (`SHELLS` for every upgrade so far). Express curves via the modifier DSL in `core/maths.ts`: a trigger (`AT_LEVEL`/`EVERY`/`RANGE`) yields a stack count, an operation turns it into a contribution (`ADDITIVE` sums `value × stacks`, `MULTIPLICATIVE` multiplies `value ^ stacks`, `MULTIPLICATIVE_LINEAR` multiplies `value × stacks`, neutral until triggered) — result is additive sum × multiplicative product. Add the `UpgradeId` member and register in `core/upgrades/upgrade-registry.ts`; `/shop`, `/shells`, `GameInstance` and the analysis script iterate the registry automatically. A single purchase is bounded by `MAX_LEVELS_PER_PURCHASE` (`core/upgrades/base-upgrade.ts`), which also caps the scan in `getMaxBuyable` — unreachable for an exponential curve, and the reason a flat-cost one cannot hang the process.

`income[resourceId] = (initial + Σ additive gains) × Π multiplicative gains`, where `initial` is `DEFAULT_SHELLS_PER_MESSAGE` for `SHELLS` and 0 otherwise, and the sums only run over upgrades whose `gainResourceId` matches. Recomputed by `GameInstance.computeIncome()` after every purchase.

### AI integration

`app/gemini/ask-gemini.ts` builds prompts from `app/commons/prompts.ts`, calls Gemini with function declarations from `app/tools/` (weather), and loops on tool calls. The model id is the `DEFAULT_MODEL` constant in `app/gemini/gemini.ts`.

That loop is bounded by `MAX_TOOL_ROUNDS`, and the way it ends matters: the final round re-sends the tool results with a per-request `config` that declares **no** tool, which leaves the model no way to ask for another one and forces a textual answer. A per-request config does not inherit the chat's (SDK contract), so `systemInstruction` has to be restated there — dropping `tools` is what does the work. The loop therefore always terminates on text, and no caller needs an "it never converged" branch.

**Memory protocol**: the model appends notes after a `### [MÉMOIRE]` marker; `app/commons/response.ts` splits the response — text before the marker goes to the user, text after is silently persisted to `{guildId}-memory.txt`. Never surface the memory half.

**Memory writes are serialized per guild.** Reading `memory.txt`, calling Gemini and writing it back is one read-modify-write whose middle step takes seconds, and `writeText` replaces the file wholesale — two overlapping cycles for the same guild would both start from the same snapshot and the later write would silently drop the earlier one. `chatWithGemini` therefore runs the whole cycle inside `enqueueForGuild` (`app/commons/guild-queue.ts`) when `saveMemory` is true, which is why it builds the prompt itself instead of taking one: the read has to happen once the guild's turn arrives. A new memory-writing entry point must go through `chatWithGemini`, never call `fileStore.writeText(…, MEMORY, …)` directly. Announcements (`saveMemory: false`) deliberately skip the queue so a jackpot is never delayed by a conversation.

The instruction to emit that marker lives in each guild's `{guildId}-system.txt`, which is not in the repo, so no test can hold the two sides together. `parseResponse` therefore matches a pattern rather than a literal: accent optional (French drops it on capitals), the English `MEMORY` accepted, any case, two to four hashes, spaces inside the brackets, and the input normalized to NFC so an `É` written as a combining accent still matches. The hashes and brackets stay mandatory — that is what keeps the word alone in a sentence from truncating a reply. Widen the pattern rather than narrowing it: a miss is silent and publishes the memory half.

`app/commons/prompts.ts` also embeds the player-facing explanation of the shells economy that is injected into every prompt — **update it whenever game mechanics change** (rates, multipliers, upgrades, commands), or the bot will describe its own rules wrongly.

## Conventions

- Strict TypeScript, ES2022, NodeNext. **Relative imports name the source file: `./foo.ts`, not `./foo.js`.** NodeNext normally forces the _emitted_ name (`.js`) in a `.ts` file; `rewriteRelativeImportExtensions` (in `tsconfig.json`) rewrites the specifier at emit instead, leaving package specifiers (`discord.js`, `decimal.js`) untouched. Consequence: the build sets `declaration: false`, since that rewrite skips `.d.ts` files, which would otherwise point at sources absent from `dist/`.
- Named exports only. `type` for data shapes, `interface` only for class/function contracts. Domain types live in a `types.ts` next to the code that owns them.
- A closed set of string values (kinds, statuses, categories) is a string `enum`, not a string-literal union — see `ChannelActivityType`, `ResourceId`, `UpgradeId` (`app/idle/core/types.ts`), `ChatTriggerKind` (`app/commons/chat-trigger.ts`). Avoids magic strings scattered across call sites.
- 4-space indent; section headers in longer files use `// ─── Title ───` rules.
- **Comments are terse.** One line is the norm, a short block only for a formula or an algorithm worth deriving (see `core/passive-income.ts`). A comment carries what the code cannot: why this ordering, why this guard, what the units are. Never restate what the next line already says, never enumerate the branches of the condition below it, and don't add a JSDoc header just because something is exported. Match the existing density in the file.
- **All user-facing strings are French** (embeds, error replies, command descriptions and options). Code, comments and identifiers are English.
- Money-like values (thresholds in `config.json`, shells in game files) are JSON **strings**, parsed with `bnFromJSON` (which also accepts legacy numbers).

## Documentation

`docs/` is written in English:

| File                     | Owns                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`   | The two runtimes and the REST surface, folder roles, layering, main flows, error handling.            |
| `docs/commands.md`       | Slash commands and their literal option names.                                                        |
| `docs/shells.md`         | Game reference: earn pipeline, heat, streak, passive income, jackpot, upgrades + modifier DSL, roles. |
| `docs/storage.md`        | The `app/storage/` layer and the format of every data file.                                           |
| `docs/configuration.md`  | Env vars, deployment, per-guild config, REST API.                                                     |
| `docs/scripts.md`        | The `scripts/` tools, including the migration flags.                                                  |
| `docs/shells-backlog.md` | Idea list. Intent only — never a source of truth on behaviour.                                        |

**Before touching an area you don't know**, read its doc first — `docs/storage.md` before changing how data is persisted, `docs/commands.md` before adding a command, `docs/shells.md` before rebalancing.

**After changing a public behaviour, data format, config option or command parameter**, update the matching doc. Keep it functional: explain _what_ and _why_, not how the code reads line by line. Balancing changes land in `docs/shells.md` **and** in the `SYSTÈME DE COQUILLAGES` block of `app/commons/prompts.ts`, or the bot describes its own rules wrongly.
