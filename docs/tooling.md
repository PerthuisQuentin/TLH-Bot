# Tooling

TypeScript, ESLint, Prettier and vitest setup, and why each is configured the way it is.

---

## The checks

Four checks must come back clean after any non-trivial change, with no known-failing file to ignore:

```bash
npx tsc --noEmit
npm run lint
npm run format:check
npm test
```

Claude Code runs them itself through the hooks in `.claude/settings.json`: `.claude/hooks/post-edit-check.js` after each edit, and `.claude/hooks/stop-check.js` before a session ends, which blocks on any failure.

A fifth one is on demand, because it needs a build: `npm run check:core` (see [below](#core-purity)).

---

## TypeScript

Strict, ES2022, NodeNext.

**Relative imports name the source file: `./foo.ts`, not `./foo.js`.** NodeNext normally forces the _emitted_ name in a `.ts` file; `rewriteRelativeImportExtensions` in `tsconfig.json` rewrites the specifier at emit instead, and leaves package specifiers (`discord.js`, `decimal.js`) untouched. The consequence is `declaration: false` in the build: the rewrite skips `.d.ts` files, which would otherwise point at sources absent from `dist/`.

**Two tsconfigs on purpose.**

- `tsconfig.json` covers everything, `scripts/` included, for the editor and `tsc --noEmit`. It excludes nothing but `node_modules` and `dist`. Keep it that way rather than widening the exclusion to silence a script.
- `tsconfig.build.json`, used by `npm run build`, excludes `scripts/` and `**/*.test.ts`, so neither reaches `dist/`.

`exclude` replaces rather than merges through `extends`, hence the repeated list.

---

## ESLint

`typescript-eslint`'s **type-checked** preset. Slower, but it is what makes `no-floating-promises`, `no-misused-promises` and `no-unnecessary-type-assertion` work.

Three rules are tuned in `eslint.config.js`, with the reason inline:

- `require-await` is off: `Command.handler` is typed `async` even when there is nothing to await.
- `restrict-template-expressions` allows `decimal.js`, for full-precision logging.
- `**/*.js` drops type-checking, since those files sit outside `tsconfig.json`.

### Rules that enforce the architecture

- **No SDK in the domain.** `no-restricted-imports` forbids `discord.js`, `@google/genai` and `@openrouter/sdk` in `app/idle/**`, `app/llm/*.ts` and `app/llm/tools/**`. The glob deliberately stops at the root of `app/llm/`: the adapters one folder down (`app/llm/gemini/`, `app/llm/openrouter/`) exist to import their SDK. Adding an adapter means adding its package to that `paths` list.
- **`app/idle/core/` imports nothing outside itself**, npm packages aside. Two `no-restricted-imports` blocks, because how far `../` reaches depends on depth: a file directly in `core/` escapes on the first `../`, one in `core/heat/` or `core/upgrades/` only on the second.
- **Named exports only.** `no-restricted-syntax` rejects `export default` and `export { x as default }` in `app/`, `app.ts`, `commands.ts` and `scripts/`. `eslint.config.js` and `vitest.config.ts` are exempt: their tools require a default export.

Not enforced: the full `routes → commands → domain → storage` ordering. Only the SDK and `core/` rules above are.

---

## Core purity

```bash
npm run check:core
```

Builds, then reads every emitted file under `dist/app/idle/core/` and fails if one imports a package other than `decimal.js` or `zod`.

ESLint already catches relative imports leaving `core/`. What only the emitted JavaScript shows is a runtime dependency hiding behind a type. `import type` vanishes at emit, but an **enum is a value**: importing one is a real dependency. That is why `ChannelActivityType` lives in `app/idle/core/types.ts` and is imported by the Discord adapter, not the reverse.

---

## Prettier

Prettier owns formatting, Markdown included. `eslint-config-prettier` is loaded last in `eslint.config.js` so no ESLint rule fights it.

`.prettierignore` keeps it away from `package.json` (npm reindents it back) and from the game data checked in at the root (`shells.json`, `config.json`, `files/`).

---

## Tests

vitest. A test sits next to what it covers, `foo.test.ts` beside `foo.ts`, with explicit imports from `'vitest'` (no `globals: true`).

Coverage is densest where the rules are: `app/idle/core/` is pure logic with no I/O, Discord or AI, so a test there inherits the layering rules for free. It is thinnest on what only a live external service would exercise, such as `app/llm/tools/weather.ts` or the gateway wiring in `app/discord/setup.ts`. Run `npm run coverage` for the file-by-file numbers rather than trusting a list written anywhere.

`vitest.config.ts` sets `coverage.include` to `app/**/*.ts` explicitly. Without it, only files a test imported are reported, and untouched modules would vanish from the report instead of showing 0 %.

---

## Environment files

Each environment has its own file, `.env.dev` or `.env.prod`, and each script names the one it reads through node's `--env-file` flag. See [configuration.md](./configuration.md#environment-variables).

No module imports `dotenv`: the file is loaded before the first module evaluates. Watch the flag order when editing a script: `tsx watch --env-file=… app.ts` works, `tsx --env-file=… watch app.ts` crashes. Without `watch`, either order works.
