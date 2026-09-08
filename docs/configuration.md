# Configuration & deployment

## Environment variables

Create a `.env` at the project root.

| Variable          | Required | Description                                                                                          |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`   | Yes      | Bot token, from the Bot tab of the developer portal.                                                 |
| `APP_ID`          | Yes      | Discord application ID.                                                                              |
| `PUBLIC_KEY`      | Yes      | Discord public key, used to verify interaction signatures.                                           |
| `GOOGLE_API_KEY`  | Yes      | Gemini API key, from AI Studio.                                                                      |
| `WEATHER_API_KEY` | Yes      | World Weather Online key, for the weather tool.                                                      |
| `OLLAMA_API_KEY`  | No       | Read by `app/ollama/`, which nothing calls today, so setting it has no effect.                       |
| `API_KEY`         | No       | Protects the REST routes. Without it no `x-api-key` can ever match, so `/api` is effectively closed. |
| `PORT`            | No       | HTTP port. Default `3000`.                                                                           |
| `FILES_DIR`       | No       | Data directory, resolved relative to the project root. Default `files`.                              |

---

## Prerequisites

- Node.js ≥ 18 (developed on 24).
- A Discord application with a bot user.
- A Gemini API key.
- A World Weather Online key.

Two **privileged intents** must be enabled in the developer portal, matching what `app/discord/setup.ts` declares: **Message Content** and **Server Members**. Without the first the bot receives empty message bodies; without the second it falls back to global names instead of server nicknames.

---

## Installation

```bash
git clone <repo-url>
cd tlh-bot
npm install
```

Then create `.env` with the variables above. There is no `.env.example` in the repo.

---

## Deployment

```bash
npm run register     # push the slash command definitions (once, and after any change)
npm run build        # tsc -p tsconfig.build.json → dist/
npm start            # node dist/app.js
```

`npm run dev` runs `tsx watch app.ts` with auto-reload. `npm run register:local` is the same as `register` with TLS verification disabled, for a corporate proxy.

`register` prints the commands it pushed and exits non-zero if the push failed — a missing `APP_ID`, or a definition Discord rejected — so it is safe to chain or to run in CI.

**Before the first start of a refactored deployment**, build `game-instances.json` from the legacy files — see [scripts.md](./scripts.md#migrate-game-instancests). Skipping it makes every player restart from zero.

Four automated checks must come back clean: `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npm test`.

### Shutdown

`SIGTERM` and `SIGINT` run one shutdown path, and the order is the point: intake stops first (the HTTP server, then the gateway client) so nothing can dirty a file again, and only then is every dirty file flushed to disk. Each step is bounded at 3 s and swallows its own error, so a stuck step can neither eat the grace period nor skip the flush behind it. A forced exit fires after 10 s overall. An uncaught exception takes the same path but exits non-zero.

---

## Per-guild configuration

`files/{guildId}-config.json`:

```json
{
    "noAskChannels": ["excluded-channel-id"],
    "noShellChannels": ["spam-channel-id"],
    "noChatChannels": ["quiet-channel-id"],
    "shellsRoles": [
        { "roleId": "bronze-role-id", "threshold": "500" },
        { "roleId": "silver-role-id", "threshold": "2000" },
        { "roleId": "gold-role-id", "threshold": "10000" }
    ],
    "chatEnabled": true,
    "chatNicknames": ["Gégé", "le bot"],
    "chatIndirectProbability": 0.1,
    "chatRandomProbability": 0.01
}
```

| Field                     | Type       | Description                                                                                                                                                                            |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noAskChannels`           | `string[]` | Channels where `/ask` refuses to answer.                                                                                                                                               |
| `noShellChannels`         | `string[]` | Channels excluded from shell earning. Heat is still tracked there.                                                                                                                     |
| `noChatChannels`          | `string[]` | Channels excluded from spontaneous chat (mentions and random joins alike).                                                                                                             |
| `shellsRoles`             | `object[]` | Roles awarded by shell threshold.                                                                                                                                                      |
| `shellsRoles[].roleId`    | `string`   | Discord role ID.                                                                                                                                                                       |
| `shellsRoles[].threshold` | `string`   | Shells required, as a **string**.                                                                                                                                                      |
| `chatEnabled`             | `boolean`  | Kill switch for spontaneous chat. Default `true` when unset.                                                                                                                           |
| `chatNicknames`           | `string[]` | Words/nicknames (case-insensitive substring match) that count as an indirect mention, e.g. the bot's name in its `system.txt` persona. Empty/unset means indirect mentions never fire. |
| `chatIndirectProbability` | `number`   | Chance (0-1) of replying to an indirect mention. Default `0.1`.                                                                                                                        |
| `chatRandomProbability`   | `number`   | Chance (0-1) of replying to any other message. Default `0.01`.                                                                                                                         |

Thresholds are strings because balances outgrow `Number.MAX_SAFE_INTEGER`. They are parsed with `bnFromJSON`, which still accepts legacy numbers, so an old config keeps working — but write new ones as strings.

A direct `@mention` of the bot always triggers a spontaneous reply — that one is not probabilistic and has no config field.

All fields are optional; a missing file reads back as `{}`.

Every write goes through the store's zod schema, so a malformed payload is rejected rather than persisted.

---

## Per-guild AI customization

**System prompt** — `files/{guildId}-system.txt` defines the bot's personality and is injected at the top of every prompt. It is also where the member-identity and mention rules live, which is what keeps the model from confusing two members who share a nickname.

**Memory** — `files/{guildId}-memory.txt` is written by the model itself, after a `### [MÉMOIRE]` marker in its response. The instruction to emit that marker lives in the same guild's `system.txt`; `app/commons/response.ts` matches it loosely (accent optional, `MEMORY` accepted, case-insensitive), so a system prompt that phrases it slightly differently still works. Entries are keyed by Discord ID, not by name.

Both are plain text and can be edited by hand or through the REST API. A hand edit is picked up on the first read occurring more than 60 seconds after the file was last loaded: there is no watcher, so the delay is bounded by that read, not by a timer. A file holding an unflushed change keeps its RAM copy and overwrites the disk instead, which is why a hand edit is only safe on a file the bot is not currently writing. Going through the REST API has neither the delay nor the risk, since it replaces the RAM copy and the file together.

---

## REST API

Served on the configured port, under `/api`, behind the `x-api-key` header.

| Method   | Route                                 | Description                                                         |
| -------- | ------------------------------------- | ------------------------------------------------------------------- |
| `GET`    | `/api/files`                          | Lists the file names present in the data directory.                 |
| `GET`    | `/api/files/:guildId/:fileType`       | Reads one guild file.                                               |
| `POST`   | `/api/files/:guildId/:fileType`       | Overwrites one guild file.                                          |
| `GET`    | `/api/guilds/:guildId/roles`          | Lists a guild's Discord roles.                                      |
| `DELETE` | `/api/messages/:channelId/:messageId` | Deletes a Discord message.                                          |
| `POST`   | `/interactions`                       | Discord webhook. Not behind the API key — Discord signs it instead. |

`:fileType` is one of `system`, `memory`, `shells`, `upgrades`, `config`, `game-instances`. Text types take `text/plain`, JSON types take `application/json` and are validated against their zod schema before anything is written.

Writes through this route are write-through: they reach the disk before the response returns.
