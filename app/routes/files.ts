import { readdir } from 'fs/promises';
import type { Request, Response } from 'express';
import {
    AllowedFiles,
    fileStore,
    getFilesDirectory,
    isTextFile,
    isValidGuildId,
    validateJsonFile,
} from '../storage/index.ts';

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

    // Express decodes %2F in a route param, so this is what stops `../` from
    // reaching getFilePath. Answering 400 here only avoids the 500 it would throw.
    if (!isValidGuildId(guildId)) {
        res.status(400).set('Content-Type', 'text/plain').send('Invalid guildId');
        return;
    }

    if (!Object.values(AllowedFiles).includes(fileType as never)) {
        res.status(400)
            .set('Content-Type', 'text/plain')
            .send(`Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(', ')}`);
        return;
    }

    const resolvedType = fileType as (typeof AllowedFiles)[keyof typeof AllowedFiles];

    try {
        if (isTextFile(resolvedType)) {
            const content = await fileStore.readText(guildId, resolvedType);
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.send(content);
        } else {
            const content = await fileStore.readJson(guildId, resolvedType);
            res.set('Content-Type', 'application/json; charset=utf-8');
            res.send(JSON.stringify(content, null, 2));
        }
    } catch (error) {
        console.error(`Error reading ${fileType} file:`, error);
        res.status(500).set('Content-Type', 'text/plain').send(`Failed to read ${fileType} file`);
    }
}

export async function writeFile(req: Request, res: Response): Promise<void> {
    const fileType = req.params.fileType as string;
    const guildId = req.params.guildId as string;

    if (!guildId) {
        res.status(400).set('Content-Type', 'text/plain').send('Missing guildId');
        return;
    }

    if (!isValidGuildId(guildId)) {
        res.status(400).set('Content-Type', 'text/plain').send('Invalid guildId');
        return;
    }

    if (!Object.values(AllowedFiles).includes(fileType as never)) {
        res.status(400)
            .set('Content-Type', 'text/plain')
            .send(`Invalid file type. Allowed values: ${Object.values(AllowedFiles).join(', ')}`);
        return;
    }

    const resolvedType = fileType as (typeof AllowedFiles)[keyof typeof AllowedFiles];
    const content = req.body as unknown;

    try {
        if (isTextFile(resolvedType)) {
            if (typeof content !== 'string') {
                res.status(400)
                    .set('Content-Type', 'text/plain')
                    .send('Content must be plain text');
                return;
            }
            await fileStore.writeText(guildId, resolvedType, content);
        } else {
            if (content === null || typeof content !== 'object') {
                res.status(400)
                    .set('Content-Type', 'text/plain')
                    .send('Content must be valid JSON');
                return;
            }
            const jsonFileType = resolvedType;
            const validationError = validateJsonFile(jsonFileType, content);
            if (validationError) {
                res.status(400)
                    .set('Content-Type', 'text/plain')
                    .send(`Invalid JSON content: ${validationError}`);
                return;
            }
            await fileStore.writeJson(guildId, jsonFileType, content);
        }
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(`${fileType} file updated successfully`);
    } catch (error) {
        console.error(`Error writing ${fileType} file:`, error);
        res.status(500).set('Content-Type', 'text/plain').send(`Failed to write ${fileType} file`);
    }
}
