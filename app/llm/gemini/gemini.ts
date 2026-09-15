import { GoogleGenAI } from '@google/genai';

export const genai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY,
});

export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
