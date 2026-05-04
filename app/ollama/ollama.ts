import 'dotenv/config';
import { Ollama } from 'ollama';

export const ollama = new Ollama({
    host: 'https://ollama.com',
    headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
});

export const DEFAULT_MODEL = 'gemini-3-flash-preview:cloud';
