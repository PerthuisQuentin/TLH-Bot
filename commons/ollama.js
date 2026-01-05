import 'dotenv/config';
import { Ollama } from 'ollama';

/**
 * Ollama instance configured for the application
 */
export const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
});
