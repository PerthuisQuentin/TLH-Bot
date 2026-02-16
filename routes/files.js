import { readdir } from 'fs/promises';
import {
  AllowedFiles,
  getFilesDirectory,
  readFileContent,
  writeFileContent,
} from '../commons/files.js';

/**
 * Handles listing existing files
 * GET /files
 */
export async function listFiles(req, res) {
  try {
    const filesDir = getFilesDirectory();
    const entries = await readdir(filesDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({ files }));
  } catch (error) {
    console.error('Error listing files:', error);
    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send('Failed to list files');
  }
}

/**
 * Handles reading a file based on the route parameter
 * GET /files/:guildId/:fileType
 */
export async function getFile(req, res) {
  const { fileType, guildId } = req.params;

  if (!guildId) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send('Missing guildId');
  }

  // Validate file type
  if (!Object.values(AllowedFiles).includes(fileType)) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send(
        `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(
          ', ',
        )}`,
      );
  }

  try {
    const content = await readFileContent(guildId, fileType);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error(`Error reading ${fileType} file:`, error);
    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send(`Failed to read ${fileType} file`);
  }
}

/**
 * Handles writing to a file based on the route parameter
 * POST /files/:guildId/:fileType
 * Body: plain text content
 */
export async function writeFile(req, res) {
  const { fileType, guildId } = req.params;

  if (!guildId) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send('Missing guildId');
  }

  // Validate file type
  if (!Object.values(AllowedFiles).includes(fileType)) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send(
        `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(
          ', ',
        )}`,
      );
  }

  try {
    const content = req.body;

    if (typeof content !== 'string') {
      res.status(400).set('Content-Type', 'text/plain');
      return res.send('Content must be plain text');
    }

    await writeFileContent(guildId, fileType, content);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`${fileType} file updated successfully`);
  } catch (error) {
    console.error(`Error writing ${fileType} file:`, error);
    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send(`Failed to write ${fileType} file`);
  }
}
