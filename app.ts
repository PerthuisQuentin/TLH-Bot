import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './app/routes/interactions.js';
import { getFile, listFiles, writeFile } from './app/routes/files.js';
import { deleteMessage } from './app/routes/messages.js';
import { listRoles } from './app/routes/guilds.js';
import { startBot } from './bot.js';
import { startReminderJob } from './app/jobs/reminder-job.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        res.status(401).set('Content-Type', 'text/plain').send('Unauthorized: API key required');
        return;
    }

    if (apiKey !== process.env.API_KEY) {
        res.status(403).set('Content-Type', 'text/plain').send('Forbidden: Invalid API key');
        return;
    }

    next();
}

const apiRouter = express.Router();
apiRouter.use(verifyApiKey);

app.post(
    '/interactions',
    verifyKeyMiddleware(process.env.PUBLIC_KEY!),
    handleInteraction,
);

// File routes
apiRouter.use('/files', express.text({ type: 'text/plain' }), express.json({ type: 'application/json' }));
apiRouter.get('/files', listFiles);
apiRouter.get('/files/:guildId/:fileType', getFile);
apiRouter.post('/files/:guildId/:fileType', writeFile);

// Message routes
apiRouter.delete('/messages/:channelId/:messageId', deleteMessage);

// Guild routes
apiRouter.get('/guilds/:guildId/roles', listRoles);

app.use('/api', apiRouter);

const server = app.listen(PORT, () => {
    console.log('Listening on port', PORT);
});

startBot().catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
});

startReminderJob();

function shutdown(signal: string): void {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed. Exiting.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
