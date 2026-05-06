# Configuration & deployment

## Environment variables

Create a `.env` file at the project root with the following variables:

| Variable          | Required | Description                                         |
| ----------------- | -------- | --------------------------------------------------- |
| `DISCORD_TOKEN`   | Yes      | Discord bot token (Bot tab in the developer portal) |
| `APP_ID`          | Yes      | Discord application ID                              |
| `PUBLIC_KEY`      | Yes      | Discord public key to verify interaction signatures |
| `GOOGLE_API_KEY`  | Yes      | Google Gemini API key (AI Studio)                   |
| `WEATHER_API_KEY` | Yes      | World Weather Online API key                        |
| `OLLAMA_API_KEY`  | No       | API key for the Ollama backend (if used)            |
| `API_KEY`         | No       | API key to protect the bot's REST routes            |
| `PORT`            | No       | HTTP server port (default: `3000`)                  |
| `FILES_DIR`       | No       | Data storage directory (default: `files/`)          |

---

## Prerequisites

- **Node.js** ≥ 18
- A Discord bot created on the [Discord developer portal](https://discord.com/developers/applications)
- A Google Gemini API key (available on [Google AI Studio](https://aistudio.google.com/))
- A World Weather Online API key (for the weather feature)

---

## Installation

```bash
# Clone the project
git clone <repo-url>
cd tlh-bot

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your keys
```

---

## Deployment

### 1. Register slash commands

Run once, or after any command change:

```bash
npm run register
```

### 2. Compile TypeScript

```bash
npm run build
```

### 3. Start the bot

```bash
npm start
```

### Development mode (auto-reload)

```bash
npm run dev
```

---

## Per-server configuration

Each Discord server can have a specific configuration in its `{guildId}-config.json` file (in the `files/` folder):

```json
{
  "noAskChannels": ["excluded-channel-id"],
  "noShellChannels": ["spam-channel-id"],
  "shellsRoles": [
    { "roleId": "bronze-role-id", "threshold": 10 },
    { "roleId": "silver-role-id", "threshold": 50 },
    { "roleId": "gold-role-id", "threshold": 200 }
  ]
}
```

| Field                     | Type       | Description                                            |
| ------------------------- | ---------- | ------------------------------------------------------ |
| `noAskChannels`           | `string[]` | Channels where the `/ask` command is disabled          |
| `noShellChannels`         | `string[]` | Channels excluded from shell earning                   |
| `shellsRoles`             | `object[]` | Roles automatically assigned based on shell thresholds |
| `shellsRoles[].roleId`    | `string`   | Discord role ID to assign                              |
| `shellsRoles[].threshold` | `number`   | Number of shells required to earn this role            |

---

## Per-server AI customization

### System prompt

The `{guildId}-system.txt` file defines the AI's personality and behavior for a given server. It is injected at the start of every conversation.

### Memory

The `{guildId}-memory.txt` file is managed automatically by the AI. After each response, if the AI detects information worth remembering, it writes it after the `### [MEMORY]` marker in its response; the bot extracts and persists that information.

---

## REST API

The bot exposes a REST API on the configured port. Routes are protected by the `API_KEY` variable (`Authorization` header).

| Method     | Route                                 | Description                             |
| ---------- | ------------------------------------- | --------------------------------------- |
| `GET/POST` | `/api/files/:guildId/:type`           | Read or write a server data file        |
| `GET`      | `/api/guilds/:guildId/roles`          | List a Discord server's roles           |
| `DELETE`   | `/api/messages/:channelId/:messageId` | Delete a Discord message                |
| `POST`     | `/interactions`                       | Discord webhook (handled automatically) |
