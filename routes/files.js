import { readContextFile, writeContextFile } from '../commons/files.js';

/**
 * Handles reading the context file
 * GET /files/context
 */
export async function getContextFile(req, res) {
  try {
    const content = await readContextFile();
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error('Error reading context file:', error);
    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send('Failed to read context file');
  }
}

/**
 * Handles writing to the context file
 * POST /files/context
 * Body: plain text content
 */
export async function writeContextFileRoute(req, res) {
  try {
    const content = req.body;

    if (typeof content !== 'string') {
      res.status(400).set('Content-Type', 'text/plain');
      return res.send('Content must be plain text');
    }

    await writeContextFile(content);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send('Context file updated successfully');
  } catch (error) {
    console.error('Error writing context file:', error);
    res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send('Failed to write context file');
  }
}
