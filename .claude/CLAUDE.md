# Agent instructions — TLH Bot

## Documentation

Before making significant changes, read the relevant files in `/docs/`:

- `docs/architecture.md` — folder structure, main processing flows, hybrid event model
- `docs/commands.md` — available slash commands and their behavior
- `docs/configuration.md` — environment variables, per-server config, REST API
- `docs/data-storage.md` — per-server file formats (shells, reminders, memory, config)

## Language

All code, comments, variable names, and documentation must be written in **English**.

## TypeScript conventions

- **Strict mode** is enabled (`"strict": true` in `tsconfig.json`). No implicit `any`.
- Target is **ES2022**, module system is **NodeNext** (`import`/`export`, `.js` extensions in imports).
- Each domain folder exposes its types in a local `types.ts` file. Keep types co-located with their domain, not in a global types file.
- Use `interface` for object shapes, `type` for unions and aliases.
- No default exports — use named exports throughout.

## Project organisation

The codebase is split by **business domain**, not by technical layer:

| Folder          | What belongs here                                                                     |
| --------------- | ------------------------------------------------------------------------------------- |
| `app/commands/` | Slash command handler for a given command — one file per command                      |
| `app/commons/`  | Truly shared, domain-agnostic utilities (file I/O, prompt building, message fetching) |
| `app/gemini/`   | Everything specific to the Gemini API (client init, request/response logic)           |
| `app/ollama/`   | Everything specific to the Ollama API                                                 |
| `app/idle/`     | All shells gamification logic (awarding, storage, role promotions)                    |
| `app/jobs/`     | Scheduled/recurring tasks                                                             |
| `app/routes/`   | Express route handlers — one file per resource                                        |
| `app/tools/`    | AI function-calling tools (schema definition + execution logic together)              |

**Rules:**

- A new AI tool goes in `app/tools/`, not in `app/gemini/` or `app/ollama/`.
- Business logic must not live in route handlers — routes only parse the request and delegate.
- Cross-domain dependencies should go through `app/commons/`, not by importing directly between domain folders.
- Per-server data is always keyed by guild ID and persisted in `files/`.

## Data & side effects

- All file reads/writes go through helpers in `app/commons/files.ts`.
- Guild ID must be passed explicitly through the call chain — no global state.
- The AI memory update protocol uses the `### [MEMORY]` marker — do not change this marker without updating both `app/commons/response.ts` and the system prompts.
