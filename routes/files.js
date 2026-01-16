import {
  AllowedFiles,
  readFileContent,
  writeFileContent,
} from '../commons/files.js';

/**
 * Handles reading a file based on the route parameter
 * GET /files/:fileType
 */
export async function getFile(req, res) {
  const { fileType } = req.params;

  // Validate file type
  if (!Object.values(AllowedFiles).includes(fileType)) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send(
        `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(
          ', '
        )}`
      );
  }

  try {
    const content = await readFileContent(fileType);
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
 * POST /files/:fileType
 * Body: plain text content
 */
export async function writeFile(req, res) {
  const { fileType } = req.params;

  // Validate file type
  if (!Object.values(AllowedFiles).includes(fileType)) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send(
        `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(
          ', '
        )}`
      );
  }

  try {
    const content = req.body;

    if (typeof content !== 'string') {
      res.status(400).set('Content-Type', 'text/plain');
      return res.send('Content must be plain text');
    }

    await writeFileContent(fileType, content);
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
