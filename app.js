import 'dotenv/config';
import express from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './app/routes/interactions.js';
import { getFile, listFiles, writeFile } from './app/routes/files.js';
import { deleteMessage } from './app/routes/messages.js';
import { listRoles } from './app/routes/guilds.js';
import { startBot } from './bot.js';
import { startReminderJob } from './app/jobs/reminder-job.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware for API routes
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res
      .status(401)
      .set('Content-Type', 'text/plain')
      .send('Unauthorized: API key required');
  }

  if (apiKey !== process.env.API_KEY) {
    return res
      .status(403)
      .set('Content-Type', 'text/plain')
      .send('Forbidden: Invalid API key');
  }

  next();
}

// API router with authentication
const apiRouter = express.Router();
apiRouter.use(verifyApiKey);

app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  handleInteraction,
);

// File routes
apiRouter.use('/files', express.text({ type: 'text/plain' }));
apiRouter.get('/files', listFiles);
apiRouter.get('/files/:guildId/:fileType', getFile);
apiRouter.post('/files/:guildId/:fileType', writeFile);

// Message routes
apiRouter.delete('/messages/:channelId/:messageId', deleteMessage);

// Guild routes
apiRouter.get('/guilds/:guildId/roles', listRoles);

// Mount API router
app.use('/api', apiRouter);

const server = app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

// Start the Discord bot
startBot().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

// Start the reminder job (runs every minute)
startReminderJob();

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed. Exiting.');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
