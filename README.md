# TLH Bot

A Discord bot in TypeScript for the _The Local Host_ server, combining a Gemini-backed assistant, an idle game and a few utilities. Every server it joins gets its own isolated configuration, memory and game state.

## Features

| Feature               | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **AI assistant**      | `/ask` answers with the channel's recent conversation, the guild memory and a per-guild system prompt as context. |
| **Shells 🐚**         | An idle game: members earn shells by taking part, buy upgrades, and unlock Discord roles by threshold.            |
| **Weather**           | The model can call a weather tool to answer weather questions.                                                    |
| **Leaderboard**       | `/leaderboard` ranks the guild by record, balance or income.                                                      |
| **Persistent memory** | The model keeps its own notes per guild, keyed by Discord ID.                                                     |

## Documentation

| Document                                   | Covers                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| [Architecture](./docs/architecture.md)     | The two runtimes, the layering, the main flows.                         |
| [Commands](./docs/commands.md)             | Every slash command and its options.                                    |
| [Shells](./docs/shells.md)                 | The game: earn pipeline, heat, streak, passive income, upgrades, roles. |
| [Storage](./docs/storage.md)               | The file store and the format of every data file.                       |
| [Configuration](./docs/configuration.md)   | Environment, deployment, per-guild config, REST API.                    |
| [Scripts](./docs/scripts.md)               | Migration, analysis and simulation tools.                               |
| [Shells backlog](./docs/shells-backlog.md) | Ideas for the game. Intent only, not current behaviour.                 |

[`.claude/CLAUDE.md`](./.claude/CLAUDE.md) holds the working conventions for the codebase.

## Quick start

```bash
npm install          # then create .env — see docs/configuration.md
npm run dev          # tsx watch, auto-reload
```

Deploying:

```bash
npm run register     # push slash command definitions to Discord
npm run build        # → dist/
npm start
```

Four automated checks, all expected to come back clean: `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npm test` (vitest; `npm run coverage` for the report).

## Tech stack

- **Runtime**: Node.js, TypeScript strict, ES2022, NodeNext modules.
- **Discord**: discord.js v14 for the gateway, `discord-interactions` for webhook signature verification.
- **HTTP**: Express v5.
- **AI**: Google Gemini (`@google/genai`), with Ollama as an alternative backend.
- **Numbers**: decimal.js, wrapped in `app/idle/core/big-number.ts` — shell balances outgrow `Number.MAX_SAFE_INTEGER`.
- **Validation**: zod, on the REST write route.
- **Persistence**: flat files under `files/`, held in RAM by `app/storage/`.
- **Tooling**: vitest for tests, ESLint with the type-checked `typescript-eslint` preset, Prettier for formatting.
