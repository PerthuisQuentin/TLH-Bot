---
name: add-slash-command
description: Recipe for adding a new Discord slash command to TLH Bot. Use when asked to create a new /command, or to change an existing command's name, options or description.
---

# Add a slash command

Background: [docs/architecture.md, Adding a slash command](../../../docs/architecture.md#adding-a-slash-command) and [Error handling](../../../docs/architecture.md#error-handling). Existing commands and their literal option names: [docs/commands.md](../../../docs/commands.md).

## Steps

1. **File**: `app/commands/<name>.ts` exporting `<name>Command: Command` (`app/commands/types.ts`), a `{ definition, handler }` object. `app/commands/ping.ts` is the minimal shape.
2. **Layering**: the handler orchestrates only. It parses with `getOption` / `requireGuild`, calls domain code, and formats the reply. Game rules belong in `app/idle/`, AI calls go through `app/llm/index.ts`, storage through `app/storage/`.
3. **Replies**: use the helpers in `app/commons/utils.ts`. If the work takes longer than Discord's 3 seconds, `replyDeferred` first and answer with `updateInteractionResponse`.
4. **Errors**: any handler touching I/O owns a try/catch so exactly one reply is sent. Work before the defer must be wrapped too; after the defer, the error path uses `updateInteractionResponseOrLog`, which never rethrows.
5. **French**: every user-facing string, including the command and option descriptions.
6. **Register** in the `commands` array of `app/commands/index.ts`. That array drives both dispatch and registration.
7. **Tests**: `app/commands/<name>.test.ts`, modelled on the existing ones.
8. **Docs**: `docs/commands.md`, and the command list inside the `SYSTÈME DE COQUILLAGES` block of `app/commons/prompts.ts`, which the bot reads when a member asks how to use a command.

## Pushing it to Discord

The definition only reaches Discord through registration, and the `PUT` replaces the whole command list:

```bash
npm run register        # dev application
npm run register:prod   # production application, only when the user asks for it
```

Registering to production changes what every member sees. Do not run `register:prod` on your own initiative.

## Done when

- The four checks pass.
- `npm run register` lists the new command.
