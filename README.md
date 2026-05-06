# TLH Bot — Documentation

TLH Bot is a Discord bot written in TypeScript that combines artificial intelligence (Google Gemini), gamification, and utility features for Discord servers.

## Features

| Feature                     | Description                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **AI Questions**            | Users ask questions via `/ask`; the bot responds using the Google Gemini API with conversation context                              |
| **Shells 🐚**               | Gamification system: users passively earn shells by participating in the server, with automatic role assignment based on thresholds |
| **Reminders**               | Create reminders using natural language, automatically processed by a scheduled job                                                 |
| **Weather**                 | The AI can call a weather tool (World Weather Online) to answer weather-related questions                                           |
| **Leaderboard**             | `/leaderboard` command displaying a paginated shells ranking per server                                                             |
| **Multi-server**            | Each Discord server has its own isolated configuration, memory, and data                                                            |
| **Adaptive AI personality** | Each server can customize the system prompt and AI memory                                                                           |

## Table of contents

- [Architecture & structure](./docs/architecture.md)
- [Available commands](./docs/commands.md)
- [Configuration & deployment](./docs/configuration.md)
- [Data storage](./docs/data-storage.md)

## Quick start

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Register slash commands with Discord
npm run register

# Start the bot
npm start

# Development mode (auto-reload)
npm run dev
```

## Tech stack

- **Runtime**: Node.js + TypeScript
- **Discord bot**: discord.js v14
- **HTTP server**: Express v5
- **Primary AI**: Google Gemini (`@google/genai`)
- **Alternative AI**: Ollama
- **Cache**: node-cache
- **TS execution**: tsx + nodemon
