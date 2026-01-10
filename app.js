import 'dotenv/config';
import express from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './routes/interactions.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.post(
  '/interactions',
  verifyKeyMiddleware(process.env.PUBLIC_KEY),
  handleInteraction
);

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
