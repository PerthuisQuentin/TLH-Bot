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

## Registering commands

Commands are registered with Discord using:

```bash
npm run register
```

This script reads the definitions from `app/commands/` and pushes them via the Discord REST API. Re-run after any command change.
