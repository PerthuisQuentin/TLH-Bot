import { readdir } from 'fs/promises';
import type { Request, Response } from 'express';
import {
    AllowedFiles,
    getFilesDirectory,
    readFileContent,
    writeFileContent,
} from '../commons/files.js';

export async function listFiles(_req: Request, res: Response): Promise<void> {
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
        res.status(500).set('Content-Type', 'text/plain').send('Failed to list files');
    }
}

export async function getFile(req: Request, res: Response): Promise<void> {
    const fileType = req.params.fileType as string;
    const guildId = req.params.guildId as string;

    if (!guildId) {
        res.status(400).set('Content-Type', 'text/plain').send('Missing guildId');
        return;
    }

    if (!Object.values(AllowedFiles).includes(fileType as never)) {
        res
            .status(400)
            .set('Content-Type', 'text/plain')
            .send(
                `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(', ')}`,
            );
        return;
    }

    try {
        const content = await readFileContent(guildId, fileType as (typeof AllowedFiles)[keyof typeof AllowedFiles]);
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

export async function writeFile(req: Request, res: Response): Promise<void> {
    const fileType = req.params.fileType as string;
    const guildId = req.params.guildId as string;

    if (!guildId) {
        res.status(400).set('Content-Type', 'text/plain').send('Missing guildId');
        return;
    }

    if (!Object.values(AllowedFiles).includes(fileType as never)) {
        res
            .status(400)
            .set('Content-Type', 'text/plain')
            .send(
                `Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(', ')}`,
            );
        return;
    }

    const content = req.body as unknown;
    if (typeof content !== 'string') {
        res.status(400).set('Content-Type', 'text/plain').send('Content must be plain text');
        return;
    }

    try {
        await writeFileContent(guildId, fileType as (typeof AllowedFiles)[keyof typeof AllowedFiles], content);
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
