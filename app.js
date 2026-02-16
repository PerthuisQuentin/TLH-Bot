import 'dotenv/config';
import express from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './routes/interactions.js';
import { getFile, listFiles, writeFile } from './routes/files.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware for file routes
function verifyFileAccess(req, res, next) {
  const apiKey = req.headers['x-files-key'];

  if (!apiKey) {
    return res
      .status(401)
      .set('Content-Type', 'text/plain')
      .send('Unauthorized: API key required');
  }

  if (apiKey !== process.env.FILES_KEY) {
    return res
      .status(403)
      .set('Content-Type', 'text/plain')
      .send('Forbidden: Invalid API key');
  }

  next();
}

app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  handleInteraction,
);

// File routes
app.use('/files', express.text({ type: 'text/plain' }));
app.get('/files', verifyFileAccess, listFiles);
app.get('/files/:guildId/:fileType', verifyFileAccess, getFile);
app.post('/files/:guildId/:fileType', verifyFileAccess, writeFile);

const server = app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});

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
