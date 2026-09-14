---
name: add-llm-tool
description: Recipe for adding a new function the AI model can call (a tool, like get_weather) in TLH Bot. Use when asked to give the bot a new capability it invokes by itself during /ask or chat.
---

# Add an LLM tool

Background: [docs/architecture.md, The AI layer](../../../docs/architecture.md#the-ai-layer). The model to copy is `app/llm/tools/weather.ts`.

## Steps

1. **The tool**: a file in `app/llm/tools/` exporting a `Tool` (`app/llm/tools/types.ts`):
    - `declaration`: name, a description telling the model **when** to use it, and parameters in the repo's `ToolParamType` vocabulary. Descriptions the model reads are in French, like the rest of the bot.
    - `execute(args)`: must **never throw**. Catch and return a French error string the model can read and work around, as `weatherTool` does.
    - No SDK import: ESLint rejects `@google/genai` and `@openrouter/sdk` in `app/llm/tools/`.
2. **Register** it in the `tools` array of `app/llm/tools/index.ts`. Nothing else dispatches by name.
3. **New parameter type?** `ToolParamType` only has `OBJECT` and `STRING`. Adding a member breaks the build in every adapter mapping (`GENAI_PARAM_TYPES` in `app/llm/gemini/provider.ts`, `OPENROUTER_PARAM_TYPES` in `app/llm/openrouter/provider.ts`) until each maps it. That is intended; fill them in.
4. **Round budget**: the comment on `MAX_TOOL_ROUNDS` in `app/llm/chat.ts` reasons from `get_weather` being the only tool. Revisit it if the new tool is meant to be chained with others.
5. **Secrets**: if the tool needs an API key, add it to `.env.dev`, `.env.prod` and `docs/configuration.md`.
6. **Tests**: next to the tool. Cover the failure path returning a string instead of throwing, with the network mocked (`vi.spyOn(globalThis, 'fetch')`).
7. **Prompt**: nothing to change by default. The declaration's description is what tells the model when to call the tool; `app/commons/prompts.ts` lists slash commands, not tools. Add a line there only if the user wants members told about the new ability.

## Done when

- The four checks pass.
- A real question that should trigger the tool produces an `[LLM] Tool | … | name=<tool>` log line.
