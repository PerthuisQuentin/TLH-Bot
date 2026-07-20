import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import type { Chat } from '@google/genai';
import { genai } from '../gemini/gemini.ts';
import { askCommand } from './ask.ts';

let dir: string;
let originalFilesDir: string | undefined;
let originalAppId: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-cmd-ask-'));
    originalFilesDir = process.env.FILES_DIR;
    originalAppId = process.env.APP_ID;
    process.env.FILES_DIR = dir;
    process.env.APP_ID = 'app-1';
    // Every test drives the model itself; none of them should reach Google.
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    if (originalAppId === undefined) delete process.env.APP_ID;
    else process.env.APP_ID = originalAppId;
    await rm(dir, { recursive: true, force: true });
});

function mockReq(body: Record<string, unknown>): Request {
    return { body } as unknown as Request;
}

type Payload = { type: number; data?: Record<string, unknown> };

function mockRes(): { res: Response; payloads: Payload[] } {
    const payloads: Payload[] = [];
    const res = {
        send: (payload: Payload) => {
            payloads.push(payload);
            return res;
        },
    };
    return { res: res as unknown as Response, payloads };
}

const askBody = (guildId: string) => ({
    guild_id: guildId,
    channel_id: 'c1',
    token: 'tok-1',
    member: { user: { id: 'u1', username: 'alice' } },
    data: { options: [{ name: 'question', value: 'Ça va ?' }] },
});

/** Answers whatever the model is asked, so the run never leaves the process. */
function stubModel(text: string): void {
    const chat = { sendMessage: vi.fn(() => Promise.resolve({ text })) };
    vi.spyOn(genai.chats, 'create').mockReturnValue(chat as unknown as Chat);
}

/** Discord REST: the channel fetch, the history fetch, then the reply edit. */
function stubDiscord(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    return fetchMock;
}

describe('askCommand, before the defer', () => {
    it('refuses a channel listed in noAskChannels', async () => {
        await writeFile(join(dir, 'g1-config.json'), JSON.stringify({ noAskChannels: ['c1'] }));

        const { res, payloads } = mockRes();
        await askCommand.handler(mockReq(askBody('g1')), res);

        expect(payloads).toHaveLength(1);
        expect(payloads[0].data?.content).toContain('pas autorisé');
    });

    // The regression: this read sat outside the try, so the rejection escaped the handler
    // with nothing sent and Discord showed « L'application n'a pas répondu ».
    it('answers with an error instead of throwing when the config file is malformed', async () => {
        await writeFile(join(dir, 'g-broken-config.json'), '{ this is not json');

        const { res, payloads } = mockRes();
        await expect(
            askCommand.handler(mockReq(askBody('g-broken')), res),
        ).resolves.toBeUndefined();

        expect(payloads).toHaveLength(1);
        expect(payloads[0].data?.content).toContain('Une erreur est survenue');
    });
});

describe('askCommand, after the defer', () => {
    it('defers first, then edits the reply with the answer', async () => {
        stubModel('Ça va bien.');
        const fetchMock = stubDiscord();

        const { res, payloads } = mockRes();
        await askCommand.handler(mockReq(askBody('g-happy')), res);

        expect(payloads).toHaveLength(1);
        // 5 = DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, and no data alongside it.
        expect(payloads[0].type).toBe(5);

        const edit = fetchMock.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(edit).toBeDefined();
        expect(edit?.[0]).toContain('/webhooks/app-1/tok-1/messages/@original');
        expect(JSON.stringify(edit?.[1])).toContain('Ça va bien.');
    });

    // The second regression: the error path's own edit was unprotected, so a failure
    // there escaped the handler with the headers already sent.
    it('resolves even when the failure reply cannot be delivered either', async () => {
        vi.spyOn(genai.chats, 'create').mockImplementation(() => {
            throw new Error('Gemini is down');
        });
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Discord is down too'));

        const { res, payloads } = mockRes();
        await expect(
            askCommand.handler(mockReq(askBody('g-double')), res),
        ).resolves.toBeUndefined();

        // The defer was sent, and nothing was thrown at Express afterwards.
        expect(payloads).toHaveLength(1);
        expect(payloads[0].type).toBe(5);
    });
});
