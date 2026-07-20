import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { handleInteraction } from './app/discord/interactions.ts';
import { getFile, listFiles, writeFile } from './app/routes/files.ts';
import { deleteMessage } from './app/routes/messages.ts';
import { listRoles } from './app/routes/guilds.ts';
import { startBot, client } from './app/discord/setup.ts';
import { startFileStore, stopFileStore } from './app/storage/index.ts';

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

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY!), handleInteraction);

// File routes
apiRouter.use(
    '/files',
    express.text({ type: 'text/plain' }),
    express.json({ type: 'application/json' }),
);
apiRouter.get('/files', listFiles);
apiRouter.get('/files/:guildId/:fileType', getFile);
apiRouter.post('/files/:guildId/:fileType', writeFile);

// Message routes
apiRouter.delete('/messages/:channelId/:messageId', deleteMessage);

// Guild routes
apiRouter.get('/guilds/:guildId/roles', listRoles);

app.use('/api', apiRouter);

// ─── Startup ─────────────────────────────────────────────────────────────────

let shuttingDown = false;

// Mirror of the shutdown order below: storage comes up before anything that can
// write to it, and goes down last.
startFileStore();

const server = app.listen(PORT, () => {
    console.log('Listening on port', PORT);
});

startBot().catch((error: unknown) => {
    // A SIGTERM during login makes it reject; exiting 1 there would report a
    // crash for what is a normal deploy replacement.
    if (shuttingDown) return;
    console.error('Failed to start bot:', error);
    process.exit(1);
});

// ─── Shutdown ────────────────────────────────────────────────────────────────

/**
 * Runs one teardown step, bounded so a stuck or rejecting step cannot eat the
 * grace period nor abort the steps after it — the store flush is the last one.
 */
function step(label: string, run: () => Promise<unknown>): Promise<void> {
    return Promise.race([
        (async () => {
            await run();
        })(),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000).unref()),
    ]).then(
        () => undefined,
        (error) => {
            console.error(`Error during shutdown (${label})`, error);
        },
    );
}

/**
 * The one shutdown path. Intake stops first — client, HTTP server — so nothing
 * can dirty a file again, and only then is the store flushed. A second handler
 * racing this one is how a `process.exit` lands before the disk write does.
 */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutting down gracefully (${reason})...`);

    const forced = setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10_000);

    server.closeAllConnections();
    await step('http', () => new Promise<void>((resolve) => server.close(() => resolve())));
    // destroy() returns a promise in discord.js v14 and can reject when the socket
    // is mid-handshake. Left floating it was a rejection nobody owned.
    await step('discord', () => client.destroy());
    await stopFileStore();

    clearTimeout(forced);
    console.log('Shutdown complete.');
    process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Node kills the process on an unhandled rejection. For a bot that has to survive
// a flaky Discord or Gemini call, logging it is better than dropping every runtime.
process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled rejection', reason);
});

// Still flush before dying, but exit non-zero: an orchestrator reading 0 would
// treat the crash as a clean stop and not report it.
process.on('uncaughtException', (error) => {
    console.error('[Process] Uncaught exception', error);
    void shutdown('uncaughtException', 1);
});
