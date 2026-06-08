---
description: Global project context for TLH Bot — apply to any task involving this codebase (new features, bug fixes, refactoring, documentation updates, configuration changes).
applyTo: '**'
---

## What this project is

TLH Bot is a multi-server Discord bot written in TypeScript. It combines an AI assistant (Google Gemini), a passive gamification system (shells 🐚), reminders, and weather queries. Each Discord server gets its own isolated configuration, AI memory, and data.

The bot runs as a Node.js process exposing an Express HTTP server that receives Discord interactions (slash commands via webhooks) alongside a real-time Discord.js client that listens to message events.

## Key principles

- **Multi-server isolation**: all data is keyed by guild ID and stored in flat files under `files/`. Nothing is shared between servers.
- **AI memory**: Gemini accumulates per-server context across conversations via a `### [MEMORY]` marker in responses — the content after the marker is silently persisted, not shown to users.
- **Gamification is passive**: shells are earned automatically on message activity, not through commands. Role promotions are triggered by `maxShells` (all-time high), not current balance.
- **Hybrid event model**: slash commands go through Express webhooks; shell logic runs on Discord.js `messageCreate` events; reminders are processed by a `setInterval` job.
- **Domain-driven structure**: code is split by business domain (`commands/`, `idle/`, `tools/`, etc.), not by technical layer. See `docs/architecture.md` for the folder map and main data flows.

## Documentation

The `docs/` folder contains the authoritative reference for understanding the project:

| File                    | Covers                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `docs/architecture.md`  | Folder structure, main processing flows, hybrid event model                |
| `docs/commands.md`      | All slash commands, their parameters, and step-by-step behavior            |
| `docs/configuration.md` | Environment variables, per-server config JSON, deployment steps            |
| `docs/data-storage.md`  | Per-server file formats (config, system prompt, memory, shells, reminders) |

**When to consult the docs**: read the relevant doc file before touching a feature area you are unfamiliar with (e.g. read `docs/data-storage.md` before changing how shells data is persisted, or `docs/commands.md` before adding a new command).

**When to update the docs**: if a code change alters a public behavior, data format, config option, command parameter, or architectural pattern, update the corresponding doc file to reflect it. Keep descriptions functional — explain _what_ and _why_, not _how_ the code works line by line.

**`app/commons/prompts.ts`** contains the user-facing description of the shells economy injected into every AI prompt. Update it whenever shells mechanics change (earn rates, multipliers, passive income rules, commands, etc.).

## Separation of concerns

Business logic must stay independent from external integrations (Discord, Gemini, Ollama). The goal is that a feature's core behavior can be understood, tested, and modified without touching any Discord or AI-specific code.

In practice:

- **Route handlers** (`app/routes/`) only parse the incoming request and delegate to a command handler. No logic lives there.
- **Command handlers** (`app/commands/`) orchestrate a feature: they load data, call domain logic, and format a response. They know about Discord inputs/outputs but not about how data is stored or how AI is called.
- **Domain modules** (`app/idle/`, `app/tools/`, etc.) contain the actual business rules. They must not import Discord.js types or AI client libraries directly.
- **AI adapters** (`app/gemini/`, `app/ollama/`) encapsulate everything specific to a given AI backend. Switching models should not require changes outside these folders.

When adding a feature, ask: _if Discord were replaced by another interface (e.g. a REST API), would the business logic need to change?_ If yes, the separation is wrong.

## Code conventions

- Strict TypeScript (`"strict": true`), ES2022, NodeNext modules. Use `.js` extensions in imports.
- Named exports only — no default exports.
- Use `type` for data shapes; `interface` only for class/function contracts.
- Domain types live in a local `types.ts` within each domain folder.
- All file reads/writes go through helpers in `app/commons/files.ts`.
- Business logic must not live in route handlers (`app/routes/`).
- New AI tools belong in `app/tools/`, not in `app/gemini/` or `app/ollama/`.
