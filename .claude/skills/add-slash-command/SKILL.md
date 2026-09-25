---
name: add-slash-command
description: Recipe for adding a new Discord slash command to TLH Bot, or buttons and selects on its reply. Use when asked to create a new /command, to change an existing command's name, options or description, or to add a button, select or confirmation to a command.
---

# Add a slash command

Background: [docs/architecture.md, Adding a slash command](../../../docs/architecture.md#adding-a-slash-command) and [Error handling](../../../docs/architecture.md#error-handling). Existing commands and their literal option names: [docs/commands.md](../../../docs/commands.md).

## Steps

1. **File**: `app/commands/<name>.ts` exporting `<name>Command: Command` (`app/commands/types.ts`), a `{ definition, handler }` object. `app/commands/ping.ts` is the minimal shape.
2. **Layering**: the handler orchestrates only. It parses with `getOption` / `requireGuild`, calls domain code, and formats the reply. Game rules belong in `app/idle/`, AI calls go through `app/llm/index.ts`, storage through `app/storage/`.
3. **Options or components**: decide first what the player types at invocation and what they choose after seeing the reply. Only the first kind is an option; the second is a button or a select ([docs/architecture.md, Buttons and other components](../../../docs/architecture.md#buttons-and-other-components)). For components, set `onComponent` on the command, build each `custom_id` with `componentCustomId(<command>, <action>)`, answer a click with `updateComponents`, re-check the state at click time, and answer 400 to an action the command never drew. `app/commands/prestige.ts` is the reference.
4. **Replies**: use the helpers in `app/commons/utils.ts`. New replies are Components V2 containers, built with `app/commons/components.ts` and sent with `replyComponents`. If the work takes longer than Discord's 3 seconds, `replyDeferred` first and answer with `updateInteractionResponse`.
5. **Errors**: any handler touching I/O owns a try/catch so exactly one reply is sent. Work before the defer must be wrapped too; after the defer, the error path uses `updateInteractionResponseOrLog`, which never rethrows.
6. **French**: every user-facing string, including the command and option descriptions.
7. **Register** in the `commands` array of `app/commands/index.ts`. That array drives both dispatch and registration.
8. **Tests**: `app/commands/<name>.test.ts`, modelled on the existing ones; `readPanel` and `mockRes` in `test/discord-interaction.ts` read a V2 reply, and `prestige.test.ts` shows how to drive a click through `onComponent`.
9. **Docs**: `docs/commands.md`, and the command list inside the `SYSTÈME DE COQUILLAGES` block of `app/commons/prompts.ts`, which the bot reads when a member asks how to use a command.

## Pushing it to Discord

The definition only reaches Discord through registration, and the `PUT` replaces the whole command list. Components are not registered: adding or changing a button alone needs no register.

```bash
npm run register        # dev application
npm run register:prod   # production application, only when the user asks for it
```

Registering to production changes what every member sees. Do not run `register:prod` on your own initiative.

## Done when

- The four checks pass.
- `npm run register` lists the new command.
