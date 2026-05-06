# Data storage

All data is persisted locally in the `files/` folder (configurable via `FILES_DIR`). Each Discord server has its own files, prefixed with the server's guild ID.

---

## File structure per server

```
files/
├── {guildId}-config.json       # Server configuration
├── {guildId}-system.txt        # System prompt (AI personality)
├── {guildId}-memory.txt        # AI accumulated memory
├── {guildId}-context.txt       # Temporary context (internal use)
├── {guildId}-shells.json       # Gamification data (shells)
└── {guildId}-reminder.json     # Pending reminders
```

---

## File details

### `{guildId}-config.json`

Server-specific configuration.

```json
{
  "noAskChannels": ["channel-id-1"],
  "noShellChannels": ["channel-id-2"],
  "shellsRoles": [
    { "roleId": "role-id-1", "threshold": 10 },
    { "roleId": "role-id-2", "threshold": 50 }
  ]
}
```

See [configuration.md](./configuration.md) for field descriptions.

---

### `{guildId}-system.txt`

Free-form text defining the AI's personality for this server. Injected at the start of the prompt on every Gemini call.

Example:

```
You are Tlh, a friendly and slightly mischievous Discord assistant.
You often use emojis.
```

---

### `{guildId}-memory.txt`

Persistent AI memory. Automatically updated when the AI decides to retain information.

**Update protocol**:

- The AI includes its notes after the `### [MEMORY]` marker in its response.
- `app/commons/response.ts` detects this marker, separates the visible response from the memorized content, and saves the latter to this file.
- The content before the marker is shown to the user; the content after is saved silently.

---

### `{guildId}-shells.json`

Gameification data. Contains the total shells and the all-time maximum for each user.

```json
{
  "userId-1": { "shells": 42, "maxShells": 87 },
  "userId-2": { "shells": 15, "maxShells": 15 }
}
```

| Field       | Description                                 |
| ----------- | ------------------------------------------- |
| `shells`    | User's current shell count                  |
| `maxShells` | All-time maximum (used for role thresholds) |

**Feeding**: On each message from a user in a non-excluded channel, 1–10 shells are added randomly, subject to a 10-second cooldown per user.

---

### `{guildId}-reminder.json`

List of pending reminders for this server.

```json
[
  {
    "userId": "user-discord-id",
    "channelId": "channel-discord-id",
    "date": "2024-06-15T10:00:00.000Z",
    "content": "Reminder: team meeting"
  }
]
```

| Field       | Description                     |
| ----------- | ------------------------------- |
| `userId`    | Discord user ID                 |
| `channelId` | Channel to post the reminder in |
| `date`      | Send date and time (ISO 8601)   |
| `content`   | Reminder content                |

**Processing**: The scheduled job (`app/jobs/reminder-job.ts`) checks every 60 seconds for reminders whose date has passed, generates a message via Gemini, posts it to the channel, then deletes the reminder from this file.

---

### `{guildId}-context.txt`

Temporary context file used internally during AI calls. Not intended for manual editing.

---

## Multi-server isolation

Each server has completely independent files. No data is shared between servers. The Discord guild ID is used as the primary key for all read/write operations.

---

## Backup

The `files/` folder contains all persistent bot data. For a full backup, simply copy this folder. To reset a server, delete the files prefixed with its guild ID.
