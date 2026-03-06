import { readFile, writeFile } from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
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
  return resolve(__dirname, '../..', filesDir);
}

/**
 * Enum for allowed files
 */
export const AllowedFiles = {
  CONTEXT: 'context',
  SYSTEM: 'system',
  MEMORY: 'memory',
  REMINDER: 'reminder',
  XP: 'xp',
};

/**
 * Gets the file path for a given guild ID and file type
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {string} extension - File extension (default: 'txt')
 * @returns {string} The absolute file path
 * @throws {Error} If file type is invalid or guildId is missing
 */
export function getFilePath(guildId, fileType, extension = 'txt') {
  if (!Object.values(AllowedFiles).includes(fileType)) {
    throw new Error(`Invalid file type: ${fileType}`);
  }

  if (!guildId || typeof guildId !== 'string') {
    throw new Error('guildId is required to resolve file path');
  }

  const fileName = `${guildId}-${fileType}.${extension}`;

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

/**
 * Reads JSON content from a specified file
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {*} defaultValue - Default value if file doesn't exist (default: [])
 * @returns {Promise<*>} The parsed JSON content
 */
export async function readJsonFile(guildId, fileType, defaultValue = []) {
  const absolutePath = getFilePath(guildId, fileType, 'json');

  try {
    const content = await readFile(absolutePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Writes JSON content to a specified file
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {*} data - Data to write (will be JSON.stringified)
 * @returns {Promise<void>}
 */
export async function writeJsonFile(guildId, fileType, data) {
  const absolutePath = getFilePath(guildId, fileType, 'json');
  await writeFile(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Reads JSON content from a specified file (synchronous)
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {*} defaultValue - Default value if file doesn't exist (default: [])
 * @returns {*} The parsed JSON content
 */
export function readJsonFileSync(guildId, fileType, defaultValue = []) {
  const absolutePath = getFilePath(guildId, fileType, 'json');

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Writes JSON content to a specified file (synchronous)
 * @param {string} guildId - The Discord guild ID
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {*} data - Data to write (will be JSON.stringified)
 * @returns {void}
 */
export function writeJsonFileSync(guildId, fileType, data) {
  const absolutePath = getFilePath(guildId, fileType, 'json');
  writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
}
