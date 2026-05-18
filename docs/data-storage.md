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

Gamification data. Contains the shells balance and earn rate for each user.

```json
[
  {
    "userId": "user-id-1",
    "shells": 42,
    "maxShells": 87,
    "shellsPerMessage": 10
  },
  {
    "userId": "user-id-2",
    "shells": 15,
    "maxShells": 15,
    "shellsPerMessage": 12
  }
]
```

| Field              | Description                                       |
| ------------------ | ------------------------------------------------- |
| `userId`           | Discord user ID                                   |
| `shells`           | User's current shell count                        |
| `maxShells`        | All-time maximum (used for role threshold checks) |
| `shellsPerMessage` | Base shells earned per message (default: `10`)    |

**Earning**: On each message in a non-excluded channel, the user earns `shellsPerMessage ± 10%` shells (random variance), subject to a 10-second cooldown per user. Role promotions are evaluated against `maxShells`, not the current balance.

---

### `{guildId}-reminder.json`

List of pending reminders for this server.

```json
[
  {
    "id": "unique-reminder-id",
    "userId": "user-discord-id",
    "channelId": "channel-discord-id",
    "date": "2024-06-15T10:00:00.000Z",
    "question": "Remind me about the team meeting",
    "createdAt": "2024-06-14T08:00:00.000Z"
  }
]
```

| Field       | Description                         |
| ----------- | ----------------------------------- |
| `id`        | Unique reminder identifier          |
| `userId`    | Discord user ID                     |
| `channelId` | Channel to post the reminder in     |
| `date`      | Send date and time (ISO 8601)       |
| `question`  | Original reminder request from user |
| `createdAt` | Creation date and time (ISO 8601)   |

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
