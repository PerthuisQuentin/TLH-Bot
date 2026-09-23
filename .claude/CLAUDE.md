# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It holds what applies to any task: commands, invariants, conventions. Reference detail lives in `docs/`, step-by-step recipes in `.claude/skills/`.

## Approach

- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## What this project is

TLH Bot is a multi-server Discord bot in TypeScript. It combines an AI assistant (Google Gemini or OpenRouter, see `AI_PROVIDER`), a passive gamification system (shells 🐚) and weather queries. Every Discord server gets its own isolated configuration, AI memory and data: guild ID is the partition key throughout, and nothing is shared between servers.

Two properties shape most of the code:

- **The gamification is passive.** Shells are earned automatically from message and reaction activity, never through a command. `/shells`, `/leaderboard` and `/shop` only read or spend what activity produced.
- **The structure is by business domain, not by technical layer.** `commands/`, `idle/`, `llm/`, `storage/` each own a slice of behaviour end to end.

## Commands

```bash
npm run dev            # tsx watch app.ts on .env.dev, auto-reload
npm run dev:prod       # same on .env.prod: runs the production bot from this machine
npm run build          # tsc → dist/
npm start              # node dist/app.js (production entry, see Procfile)
npm run register       # push slash command definitions to the DEV app
npm run register:prod  # same, against the production app
npm run register:local # dev app, TLS verification disabled (corporate proxy)
npx tsc --noEmit       # typecheck only
npm run lint           # eslint, type-aware (lint:fix applies the safe fixes)
npm run format         # prettier --write (format:check is read-only)
npm test               # vitest, single pass (test:watch, coverage)
npm run sandbox        # interactive idle sandbox on a compressed clock, no Discord
npm run check:core     # build, then verify app/idle/core/ imports only allowed packages
```

The four automated checks are `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npm test`. Run them after any non-trivial change; all four must come back clean, there are no known-failing files to ignore. Why the tooling is configured as it is: `docs/tooling.md`.

**There is no `.env`.** Each environment has its own gitignored file, `.env.dev` or `.env.prod`, named by each script through node's `--env-file`; a missing file aborts the start rather than falling back to the other one. They differ by Discord application and by `FILES_DIR` (`files` / `prod-files`). Variables: `docs/configuration.md`.

## Architecture

`app.ts` boots **two concurrent runtimes** in one process; knowing which one a code path belongs to is the key to navigating this repo:

| Runtime                   | Entry                                                | Handles                                                                        |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Express webhook           | `POST /interactions` → `app/discord/interactions.ts` | slash commands (Discord signs the request; `verifyKeyMiddleware` validates it) |
| discord.js gateway client | `app/discord/setup.ts` → `app/discord/handlers.ts`   | `messageCreate` / `messageReactionAdd` → shell earning, role promotions        |

Plus a key-protected REST API under `/api` (`x-api-key` header), used by an external admin surface, not by Discord.

A slash command is one `{ definition, handler }` object in `app/commands/<name>.ts`, listed in the `commands` array of `app/commands/index.ts`, which drives both dispatch and registration. Handlers receive raw Express `req`/`res` and reply through the helpers in `app/commons/utils.ts`. Details, including the defer boundary: `docs/architecture.md`.

### Layering

`app/routes/` (parse only) → `app/commands/` (orchestrate + format Discord response) → domain (`app/idle/`, `app/llm/`) → storage (`app/storage/`).

The goal is that a feature's core behaviour can be read, reasoned about and changed without touching any Discord- or AI-specific code.

- **Route handlers** parse the request and delegate. No logic.
- **Command handlers** orchestrate: load data, call domain logic, format a reply. They know Discord's inputs and outputs, not how data is stored or how the AI is called.
- **Domain** holds the rules and imports neither `discord.js` nor an AI SDK (lint-enforced). `app/idle/` may import the type-only declarations in `app/discord/types.ts`.
- **`app/idle/core/` imports nothing outside itself**, npm packages aside. `npm run check:core` verifies the build output. An enum is a value, so importing one is a real runtime dependency, unlike `import type`.
- **AI adapters** (`app/llm/gemini/`, `app/llm/openrouter/`) hold everything specific to one backend. The engine and the tools above them stay SDK-free.

The test when adding a feature: _if Discord were replaced by another interface, a REST API or a CLI, would the business logic have to change?_ If yes, the separation is wrong.

The seam between Discord and the game is two files: `app/discord/handlers.ts` builds a `DiscordEvent` for `app/idle/handlers/handle-event.ts`, which returns a plain result that the caller turns back into Discord side effects.

### Persistence

All state is flat files under `FILES_DIR`, named `{guildId}-{fileType}.{txt|json}`, accessed **only** through `app/storage/` (the `fileStore` singleton). Files are held in RAM, and the in-RAM copy is authoritative while dirty.

- `fileStore.updateJson(guildId, type, mutate)` is the **only** correct way to change a JSON file. `mutate` must be synchronous: that is what makes the read-modify-write atomic. `readJson` then `writeJson` reintroduces the lost-update race.
- `readJson` returns the live in-RAM object. Treat it as read-only.
- `updateJson` writes behind. A change the user is told succeeded needs a flush behind it.
- **`app.ts` owns the only shutdown path.** Never register a signal handler anywhere else: a second one racing it is how `process.exit` lands before the disk write.
- Two containers sharing the data directory corrupt each other. Stop the old one before starting the new one.
- Missing JSON files read back as defaults. Missing **text** files reject with `ENOENT` on purpose, because `prompts.ts` relies on it for its own fallback.

Timings, atomic writes, adding a file type, every file format: `docs/storage.md`.

### The shells game

- A player is a `GameInstance`. `getGameInstance` / `getAllGameInstances` return a `ReadonlyGameInstance`, detached from what is persisted. To change a player, `updateGameInstance(guildId, userId, mutate)`, mutating **inside** the synchronous callback without letting the instance escape; a change the player is told succeeded needs `flushGameInstances(guildId)` behind it.
- **All shell arithmetic goes through `app/idle/core/big-number.ts`.** Balances reach 10^30 and beyond, so a native `number` must never hold one.
- **Roles key off `maxShells`**, the all-time peak, never the current balance, so spending can't demote anyone.

Earn pipeline, heat, growth rings, passive income, jackpot, upgrades and the modifier DSL: `docs/shells.md`.

### AI integration

- `app/llm/index.ts` is the only entry point the rest of the app knows. The backend is `AI_PROVIDER` (`gemini` by default, or `openrouter`), validated at boot.
- **A new memory-writing entry point goes through `chatWithLlm`**, never `fileStore.writeText(…, MEMORY, …)`: the read of `memory.txt`, the model call and the write-back are serialized per guild, or overlapping calls silently drop each other's update.
- The model appends memory notes after a `### [MÉMOIRE]` marker. **Never surface the memory half.** The pattern in `app/commons/response.ts` is widened, never narrowed: a miss is silent and publishes the memory to the channel.
- Adapters never wrap an error: `/ask` branches on the original object through `classifyError`.
- Only the engine logs. Prompts and replies are never logged.
- `app/commons/prompts.ts` embeds the player-facing explanation of the game (`SYSTÈME DE COQUILLAGES`). **Update it whenever a mechanic or command changes**, or the bot describes its own rules wrongly.

Providers, tools, the bounded tool loop and the log format: `docs/architecture.md`, section The AI layer.

## Conventions

- Strict TypeScript, ES2022, NodeNext. **Relative imports name the source file: `./foo.ts`, not `./foo.js`** (rewritten at emit, see `docs/tooling.md`).
- Named exports only (lint-enforced). `type` for data shapes, `interface` only for class/function contracts. Domain types live in a `types.ts` next to the code that owns them.
- A closed set of string values (kinds, statuses, categories) is a string `enum`, not a string-literal union: see `ChannelActivityType`, `ResourceId`, `UpgradeId` (`app/idle/core/types.ts`), `ChatTriggerKind` (`app/commons/chat-trigger.ts`), `LlmCallKind` (`app/llm/types.ts`).
- 4-space indent; section headers in longer files use `// ─── Title ───` rules.
- **Comments are terse.** One line is the norm, a short block only for a formula or an algorithm worth deriving (see `core/passive-income.ts`). A comment carries what the code cannot: why this ordering, why this guard, what the units are. Never restate what the next line already says, never enumerate the branches of the condition below it, and don't add a JSDoc header just because something is exported. Match the existing density in the file.
- **All user-facing strings are French** (embeds, error replies, command descriptions and options). Code, comments and identifiers are English.
- Money-like values (thresholds in `config.json`, shells in game files) are JSON **strings**, parsed with `bnFromJSON` (which also accepts legacy numbers).
- Tests sit next to what they cover, `foo.test.ts` beside `foo.ts`, with explicit imports from `'vitest'`.
- **Commits use gitmoji**: `:emoji: Imperative summary` in English, one commit per branch, never on `main`. PRs are squash-merged and GitHub appends `(#NN)`. Steps: the `workflow` skill.

## Documentation

`docs/` is written in English:

| File                      | Owns                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`    | The two runtimes and the REST surface, folder roles, layering, main flows, the AI layer, error handling.              |
| `docs/commands.md`        | Slash commands and their literal option names.                                                                        |
| `docs/shells.md`          | Game reference: earn pipeline, heat, growth rings, passive income, jackpot, upgrades + modifier DSL, prestige, roles. |
| `docs/storage.md`         | The `app/storage/` layer and the format of every data file.                                                           |
| `docs/configuration.md`   | Env vars, deployment, per-guild config, REST API.                                                                     |
| `docs/tooling.md`         | TypeScript, ESLint, Prettier and test setup, the lint-enforced layering rules, the core purity check.                 |
| `docs/scripts.md`         | The `scripts/` tools: analysis, simulations, sandbox, core purity check.                                              |
| `docs/prestige-design.md` | Why the prestige numbers are what they are: calibration, rejected variants, naming. Not behaviour.                    |
| `docs/shells-backlog.md`  | Idea list. Intent only, never a source of truth on behaviour.                                                         |

**Before touching an area you don't know**, read its doc first: `docs/storage.md` before changing how data is persisted, `docs/commands.md` before adding a command, `docs/shells.md` before rebalancing, `docs/prestige-design.md` before touching a prestige constant or a coral curve.

**After changing a public behaviour, data format, config option or command parameter**, update the matching doc. Keep it functional: explain _what_ and _why_, not how the code reads line by line. Balancing changes land in `docs/shells.md` **and** in the `SYSTÈME DE COQUILLAGES` block of `app/commons/prompts.ts`.

## Skills

Recipes for recurring tasks live in `.claude/skills/` and load when the task matches: `workflow` (discuss, plan, execute step by step, commit and push), `add-llm-provider`, `add-llm-tool`, `add-upgrade`, `add-slash-command`, `rebalance-shells`. They hold the steps; the invariants above apply whether or not a skill is loaded.
