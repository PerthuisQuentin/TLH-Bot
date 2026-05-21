# Available commands

Commands are Discord slash commands (prefix `/`). They are registered with the Discord API via `npm run register`.

---

## `/ping`

**Description**: Checks that the bot is running.

**Parameters**: none

**Response**: `Pong!`

**Available in**: servers, DMs, all contexts

---

## `/ask`

**Description**: Ask the AI a question. The bot takes into account the conversation context (last 50 messages in the channel), the server memory, and the custom system prompt.

**Parameters**:

| Parameter  | Type   | Required | Description                |
| ---------- | ------ | -------- | -------------------------- |
| `question` | String | Yes      | The question to ask the AI |

**Behavior**:

1. Checks that the channel is not listed in `noAskChannels` in the server config.
2. Fetches the last 50 messages from the channel to build context.
3. Loads the server memory and system prompt.
4. Sends a deferred response to Discord (allows up to 15 minutes to process).
5. Calls Google Gemini with the available tools (weather, reminders).
6. If the AI invokes a tool, executes it automatically and sends the result back to Gemini.
7. Parses the response to extract a possible memory update (`### [MEMORY]` marker).
8. Posts the final response to the channel with mention of the question's author.
9. Saves memory if it was updated by the AI.

**AI-accessible tools**:

| Tool           | Trigger          | Action                               |
| -------------- | ---------------- | ------------------------------------ |
| `get_weather`  | Weather question | Call to World Weather Online         |
| `set_reminder` | Reminder request | Creates a reminder persisted as JSON |

**Available in**: servers, DMs, all contexts

---

## `/leaderboard`

**Description**: Displays the server's shells (🐚) ranking in descending order.

**Parameters**:

| Parameter | Type        | Required | Description                                   |
| --------- | ----------- | -------- | --------------------------------------------- |
| `page`    | Integer ≥ 1 | No       | Page number (10 entries per page, default: 1) |

**Behavior**:

1. Loads the server's `shells.json` file.
2. Sorts users by shell count in descending order.
3. Displays 10 entries per page with their rank, Discord username, and total shells.
4. Highlights the row of the user who requested the leaderboard.
5. Indicates if the user is not yet ranked.
6. Shows total participant count and pagination info.

**Response format**: Discord embed (color `#FFD700`)

**Available in**: servers only

---

## `/shells`

**Description**: Displays a user's shells (🐚) profile: current count, rank, earn rate, current role, and next role to unlock.

**Parameters**:

| Parameter     | Type | Required | Description                                               |
| ------------- | ---- | -------- | --------------------------------------------------------- |
| `utilisateur` | User | No       | User whose profile to display (defaults to the requester) |

**Behavior**:

1. Resolves the target user (the `utilisateur` parameter if provided, otherwise the requester).
2. Loads the server's `shells.json` leaderboard and determines the user's rank.
3. Reads `shellsRoles` from the server config to determine the current and next role.
4. Builds an embed with the following fields:
   - **Rang**: rank on the server leaderboard, or "Non classé".
   - **Coquillages**: current shell count.
   - **Gain par message**: shells earned per message (±10% random variance).
   - **Rôle actuel**: Discord role currently held based on `maxShells`, or "Aucun" if none configured.
   - **Prochain rôle**: next role to unlock and how many shells are still needed, or "✨ Rang maximum atteint".
5. If the historical maximum (`maxShells`) differs from the current count, it is shown in the embed footer.

**Response format**: Discord embed (color `#FFD700`)

**Available in**: servers only

---

## `/shop`

**Description**: Displays the upgrade shop or purchases upgrade levels using shells (🐚).

**Parameters**:

| Parameter  | Type        | Required | Description                               |
| ---------- | ----------- | -------- | ----------------------------------------- |
| `upgrade`  | Choice      | No       | Upgrade to purchase (omit to just browse) |
| `quantite` | Integer ≥ 1 | No       | Number of levels to buy (default: 1)      |

**Behavior**:

- **Without `upgrade`** (listing mode):
  1. Loads the user's current shells and upgrade levels.
  2. Displays each upgrade with its current level, current gain, next-level cost, and how many levels the user can afford.
  3. Response is ephemeral (only visible to the requesting user).

- **With `upgrade`** (purchase mode):
  1. Validates the requested quantity against the user's shell balance.
  2. Deducts the total cost (geometric series) from the user's shells.
  3. Increments the upgrade level(s) and recomputes `shellsPerMessage`.
  4. Returns a confirmation embed showing old → new level, cost, and new gain.
  5. Responds with an error if the user cannot afford even one level.

**Response format**: Ephemeral Discord embed (listing: color `#4FC3F7`, purchase: color `#66BB6A`)

**Available in**: servers only

---

## `/heat`

**Description**: Displays the current conversation heat of the channel and its active contributors.

**Parameters**: none

**Behavior**:

1. Reads the in-memory heat state for the current channel.
2. Renders a 12-block progress bar representing the heat level.
3. Shows the heat value and the resulting shells multiplier (×1.0 to ×2.0).
4. Lists active contributors with their relative share of channel activity (%).
5. The embed color scales with the multiplier: green (×1.0–1.0) → yellow → orange → red (×2.0).

**Response format**: Discord embed (color varies with heat level)

**Available in**: servers only

---

## Registering commands

Commands are registered with Discord using:

```bash
npm run register
```

This script reads the definitions from `app/commands/` and pushes them via the Discord REST API. Re-run after any command change.
