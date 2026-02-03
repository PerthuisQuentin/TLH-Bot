import 'dotenv/config';
import express from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './routes/interactions.js';
import { getFile, writeFile } from './routes/files.js';

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
  handleInteraction
);

// File routes
app.use('/files', express.text({ type: 'text/plain' }));
app.get('/files/:fileType', verifyFileAccess, getFile);
app.post('/files/:fileType', verifyFileAccess, writeFile);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
