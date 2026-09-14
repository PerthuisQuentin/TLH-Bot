---
name: add-llm-provider
description: Recipe for adding a new AI backend (LLM provider) behind app/llm/ in TLH Bot, alongside Gemini and OpenRouter. Use when asked to add, wire or support a new model provider, SDK or AI API.
---

# Add an LLM provider

Background first: [docs/architecture.md, The AI layer](../../../docs/architecture.md#the-ai-layer). Mirror the two existing adapters, `app/llm/gemini/` and `app/llm/openrouter/`, rather than inventing a new shape.

## Before writing code

- Verify the SDK in its own type declarations under `node_modules/`, not from memory or a blog post: package name and version, client constructor, request shape, how tool calls come back (are arguments an object or a JSON string?), how a tool result is sent back (does it need a call id?), how errors expose an HTTP status, whether a cost is reported.
- Verify the model id exists and supports tools. With the OpenRouter MCP connected, `get-model` answers both.

## Steps

1. **Client**: `app/llm/<name>/<name>.ts` builds the SDK client from an env var and exports `DEFAULT_MODEL`.
2. **Adapter**: `app/llm/<name>/provider.ts` exports `<name>Provider: LlmProvider`.
    - A `to<Name>Tool` mapping from `ToolFunctionDeclaration` to the SDK's schema. Map `ToolParamType` explicitly with a `Record<ToolParamType, …>` so a new param type fails to compile here.
    - A session class implementing `LlmSession`. Keep the history the SDK needs; if it is a message array, send a **copy** on each request, since the array keeps growing after the call.
    - `sendToolResults` must honour `disarmTools`: the request carries no tool the model could call.
    - Normalize every tool call to `{ id, name, args }`. If the API mints call ids, use them; if not, use the name. Parse string arguments defensively: malformed JSON yields `{}` and a log, never a throw.
    - Set `costUsd` on the turn only if the API reports a per-request cost.
    - `classifyError` returns `LlmErrorKind.OVERLOADED` for failures a retry would fix (typically 429, 502, 503, 504) and `UNKNOWN` otherwise. Never wrap or replace the error.
    - Adapters never log; the engine does.
3. **Register**: add the `LlmProviderId` member in `app/llm/types.ts` and the entry in `PROVIDERS` in `app/llm/provider.ts`.
4. **Layering**: add the SDK package to the `no-restricted-imports` `paths` list in `eslint.config.js`, so the neutral layer can never import it.
5. **Env**: add the key to both `.env.dev` and `.env.prod` (empty value if the user has not given one) and to the table in `docs/configuration.md`.
6. **Tests**: `app/llm/<name>/provider.test.ts`, modelled on `app/llm/openrouter/provider.test.ts`: schema mapping, opening messages with tools declared, a tool round trip carrying the call id, tools absent when disarmed, cost when reported, `classifyError`.
7. **Docs**: `docs/architecture.md` (folder table and The AI layer), `docs/configuration.md`, `README.md` tech stack, and the adapter lists in `.claude/CLAUDE.md`.

## Done when

- The four checks pass.
- `AI_PROVIDER=<name>` boots: the log shows `[LLM] Provider=<name> | model=…`, and an invalid value lists the new id among the accepted ones.
- Say plainly whether a real call was made. Without a key, the request shape is only as good as the SDK types it was built from.
