import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Enum for allowed files
 */
export const AllowedFiles = {
  CONTEXT: 'context',
  SYSTEM: 'system',
  MEMORY: 'memory',
};

/**
 * Gets the file path for a given file type
 * @param {string} fileType - The file type from AllowedFiles enum
 * @returns {string} The absolute file path
 * @throws {Error} If file type is invalid or environment variable is not set
 */
function getFilePath(fileType) {
  if (!Object.values(AllowedFiles).includes(fileType)) {
    throw new Error(`Invalid file type: ${fileType}`);
  }

  const filesDir = process.env.FILES_DIR || 'files';
  const fileName = `${fileType}.txt`;

  return resolve(__dirname, '..', filesDir, fileName);
}

/**
 * Writes content to a specified file
 * @param {string} fileType - The file type from AllowedFiles enum
 * @param {string} content - Content to write to the file
 * @returns {Promise<void>}
 */
export async function writeFileContent(fileType, content) {
  const absolutePath = getFilePath(fileType);
  await writeFile(absolutePath, content, 'utf-8');
}

/**
 * Reads content from a specified file
 * @param {string} fileType - The file type from AllowedFiles enum
 * @returns {Promise<string>} The file content
 */
export async function readFileContent(fileType) {
  const absolutePath = getFilePath(fileType);
  const content = await readFile(absolutePath, 'utf-8');
  return content;
}
