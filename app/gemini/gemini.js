import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

/**
 * Google GenAI instance configured for the application
 */
export const genai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
/**
 * Default model to use for chat
 */
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
