# Architecture & project structure

## Folder structure

| Folder          | Role                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------- |
| `app/commands/` | Slash command definitions and handlers (`/ping`, `/ask`, `/leaderboard`)                      |
| `app/commons/`  | Shared utilities: file I/O, memory, message fetching, prompt building, response parsing       |
| `app/gemini/`   | Google Gemini client and request logic with tool/function calling support                     |
| `app/ollama/`   | Alternative AI backend using Ollama (local or cloud models)                                   |
| `app/idle/`     | Shells gamification: award shells on messages, cooldown management, role threshold promotions |
| `app/jobs/`     | Scheduled jobs — processes expired reminders every 60 seconds                                 |
| `app/routes/`   | Express HTTP routes: Discord webhook (`/interactions`) and REST API (`/api/…`)                |
| `app/tools/`    | AI-callable tools: weather (World Weather Online) and reminder creation                       |
| `files/`        | Persistent per-server storage: config, system prompt, memory, shells, reminders               |

---

## Main processing flows

### `/ask` command

```
User → /ask question
    ↓
POST /interactions (Express)
    ↓
app/routes/interactions.ts → app/commands/ask.ts
    ↓
Load last 50 messages from the channel
Load server config, memory and system prompt
    ↓
app/gemini/ask-gemini.ts
    ├── Build prompt (date, timezone, personality)
    ├── Call Gemini with tools (weather, reminders)
    └── Process tool calls if needed
    ↓
app/commons/response.ts: extract memory (### [MEMORY] marker)
    ↓
Post response to Discord + save memory if updated
```

### Shells system (passive)

```
User sends a message
    ↓
bot.ts: messageCreate event
    ↓
app/idle/shells.ts
    ├── Check cooldown (node-cache, 10 sec)
    ├── Award 1–10 random shells
    └── Check role thresholds
        ↓
app/idle/shells-roles.ts
    ├── Read server shellsRoles config
    ├── Assign new Discord role if threshold reached
    └── Generate promotion message via Gemini
```

### Reminders (scheduled job)

```
Every 60 seconds
    ↓
app/jobs/reminder-job.ts
    ↓
Iterate over all servers' reminder.json files
    ↓
For each expired reminder:
    ├── Call Gemini with the reminder context
    ├── Post response to the original channel
    └── Delete the reminder
```

---

## Hybrid event model

The bot combines three processing models:

| Model          | Technology  | Usage                                         |
| -------------- | ----------- | --------------------------------------------- |
| Real-time      | Discord.js  | Shell gains, role promotions, event listeners |
| HTTP webhooks  | Express     | Slash commands, Discord interactions          |
| Scheduled jobs | setInterval | Process expired reminders                     |
