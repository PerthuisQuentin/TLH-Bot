import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Gets the absolute path to the files directory
 * @returns {string} The absolute directory path
 */
export function getFilesDirectory() {
  const filesDir = process.env.FILES_DIR || 'files';
  return resolve(__dirname, '..', filesDir);
}

/**
 * Enum for allowed files
 */
export const AllowedFiles = {
  CONTEXT: 'context',
  SYSTEM: 'system',
  MEMORY: 'memory',
};

/**
 * Gets the file path for a given guild ID and file type
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @returns {string} The absolute file path
 * @throws {Error} If file type is invalid or guildId is missing
 */
export function getFilePath(guildId, fileType) {
  if (!Object.values(AllowedFiles).includes(fileType)) {
    throw new Error(`Invalid file type: ${fileType}`);
  }

  if (!guildId || typeof guildId !== 'string') {
    throw new Error('guildId is required to resolve file path');
  }

  const fileName = `${guildId}-${fileType}.txt`;

  return resolve(getFilesDirectory(), fileName);
}

/**
 * Writes content to a specified file
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {string} content - Content to write to the file
 * @returns {Promise<void>}
 */
export async function writeFileContent(guildId, fileType, content) {
  const absolutePath = getFilePath(guildId, fileType);
  await writeFile(absolutePath, content, 'utf-8');
}

/**
 * Reads content from a specified file
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @returns {Promise<string>} The file content
 */
export async function readFileContent(guildId, fileType) {
  const absolutePath = getFilePath(guildId, fileType);
  const content = await readFile(absolutePath, 'utf-8');
  return content;
}
