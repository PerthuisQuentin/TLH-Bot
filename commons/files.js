import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Writes content to the file specified in CONTEXT_FILE_PATH env variable
 * @param {string} content - Content to write to the file
 * @returns {Promise<void>}
 */
export async function writeContextFile(content) {
  const filePath = process.env.CONTEXT_FILE_PATH;
  if (!filePath) {
    throw new Error('CONTEXT_FILE_PATH environment variable is not set');
  }

  const absolutePath = resolve(__dirname, '..', filePath);
  await writeFile(absolutePath, content, 'utf-8');
}

/**
 * Reads content from the file specified in CONTEXT_FILE_PATH env variable
 * @returns {Promise<string>} The file content
 */
export async function readContextFile() {
  const filePath = process.env.CONTEXT_FILE_PATH;
  if (!filePath) {
    throw new Error('CONTEXT_FILE_PATH environment variable is not set');
  }

  const absolutePath = resolve(__dirname, '..', filePath);
  const content = await readFile(absolutePath, 'utf-8');
  return content;
}
