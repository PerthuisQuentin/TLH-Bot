import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Chat } from '@google/genai';
import { genai } from './gemini.ts';
import {
    ask,
    generateJackpotMessage,
    generateRolePromotionMessage,
    MAX_TOOL_ROUNDS,
} from './ask-gemini.ts';

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-ask-gemini-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

/** Prompt building reads both text files; writing them keeps the ENOENT fallbacks quiet. */
async function writeGuildFiles(guildId: string): Promise<void> {
    await writeFile(join(dir, `${guildId}-system.txt`), 'Tu es un bot de test.');
    await writeFile(join(dir, `${guildId}-memory.txt`), 'Rien pour le moment.');
}

type FakeResponse = {
    text?: string;
    functionCalls?: Array<{ name: string; args: Record<string, string> }>;
};

type SendParams = { message: unknown; config?: { systemInstruction?: string } };

type FakeChat = { sendMessage: ReturnType<typeof vi.fn> };

/** Installs `reply` as the chat the real client would have returned. */
function fakeChat(reply: (params: SendParams, call: number) => FakeResponse): FakeChat {
    let call = 0;
    const sendMessage = vi.fn((params: SendParams) => Promise.resolve(reply(params, call++)));

    const chat = { sendMessage };
    vi.spyOn(genai.chats, 'create').mockReturnValue(chat as unknown as Chat);
    return chat;
}

/** The name is unknown to processFunctionCall, which answers "Fonction inconnue" without
 *  any network — the loop is exercised, nothing else is. */
const TOOL_CALL = { name: 'unknown_tool', args: {} };
const WANTS_TOOL: FakeResponse = { functionCalls: [TOOL_CALL] };

/**
 * A model that never stops asking, whatever it is sent. Finite on purpose: it gives up
 * after 50 rounds, so removing the cap makes the test below fail on the call count
 * rather than hang the runner. A test that proves a bound must not need it to terminate.
 */
function alwaysAsksForTools(): FakeChat {
    return fakeChat((_params, call) => (call < 50 ? WANTS_TOOL : { text: 'Trop tard.' }));
}

/**
 * A faithful model: it can only emit a tool call while a tool is declared. A request
 * carrying a per-request config has none (that config does not inherit the chat's), so
 * this one answers in text exactly when the last round disarms it.
 */
function answersOnceDisarmed(): FakeChat {
    return fakeChat((params) => (params.config ? { text: 'Réponse finale.' } : WANTS_TOOL));
}

const askParams = (guildId: string) => ({
    guildId,
    channelName: 'general',
    conversationContext: [],
    userName: 'Alice',
    userQuestion: 'Il fait quel temps ?',
});

describe('chatWithGemini, nominal paths', () => {
    it('returns the answer and persists the memory half when no tool is called', async () => {
        const guildId = 'g-direct';
        await writeGuildFiles(guildId);
        const chat = fakeChat(() => ({
            text: 'Il fait beau.\n### [MÉMOIRE]\nAlice aime le soleil.',
        }));

        const result = await ask(askParams(guildId));

        expect(result.response).toBe('Il fait beau.');
        expect(chat.sendMessage).toHaveBeenCalledTimes(1);
        expect(await readFile(join(dir, `${guildId}-memory.txt`), 'utf-8')).toBe(
            'Alice aime le soleil.',
        );
    });

    it('runs one tool round without degrading it, so the fix costs the happy path nothing', async () => {
        const guildId = 'g-one-round';
        await writeGuildFiles(guildId);
        const chat = fakeChat((_params, call) => (call === 0 ? WANTS_TOOL : { text: '20°C.' }));

        const result = await ask(askParams(guildId));

        expect(result.response).toBe('20°C.');
        expect(chat.sendMessage).toHaveBeenCalledTimes(2);
        // No per-request config below the cap: the chat's own tools stay in play.
        for (const [params] of chat.sendMessage.mock.calls as Array<[SendParams]>) {
            expect(params).not.toHaveProperty('config');
        }
    });
});

describe('chatWithGemini, concurrent same-guild calls', () => {
    it("serializes two concurrent ask() calls so the second sees the first's memory write", async () => {
        const guildId = 'g-concurrent';
        await writeGuildFiles(guildId);

        let resolveFirst!: (reply: FakeResponse) => void;
        const gate = new Promise<FakeResponse>((resolve) => {
            resolveFirst = resolve;
        });
        let call = 0;
        const sendMessage = vi.fn<(params: SendParams) => Promise<FakeResponse>>(() =>
            call++ === 0
                ? gate
                : Promise.resolve({ text: 'B.\n### [MÉMOIRE]\nMemory from A seen.' }),
        );
        vi.spyOn(genai.chats, 'create').mockReturnValue({ sendMessage } as unknown as Chat);

        const firstPromise = ask(askParams(guildId));
        const secondPromise = ask(askParams(guildId));

        // Real fs reads (system/memory prompt building) sit between the queue dequeue
        // and the first sendMessage call, so wait for it rather than counting ticks.
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        resolveFirst({ text: 'A.\n### [MÉMOIRE]\nMemory from A.' });
        await firstPromise;
        await secondPromise;

        // The load-bearing assertion: the second call's own prompt, built only once its
        // queue turn arrives, embeds the first call's freshly written memory rather than
        // the stale snapshot both calls would have read if unserialized.
        const secondPrompt = sendMessage.mock.calls[1][0].message as string;
        expect(secondPrompt).toContain('Memory from A.');

        expect(await readFile(join(dir, `${guildId}-memory.txt`), 'utf-8')).toBe(
            'Memory from A seen.',
        );
    });
});

// An announcement decorates an event that already happened, so it has to produce a line
// whatever Gemini does — these pin the fallback both announcement types share.
describe('announcements, when Gemini fails', () => {
    const announcementParams = (guildId: string) => ({
        guildId,
        channelName: 'general',
        conversationContext: [],
        userName: 'Alice',
    });

    beforeEach(() => {
        fakeChat(() => {
            throw new Error('Gemini est tombé');
        });
    });

    it('falls back to the default jackpot line, keeping its 🎉 marker', async () => {
        await writeGuildFiles('g-jackpot-down');
        const message = await generateJackpotMessage({
            ...announcementParams('g-jackpot-down'),
            amount: '1.00K',
            multiplier: 1000,
        });

        expect(message).toContain('🎉');
        expect(message).toContain('1.00K');
    });

    // The two markers must stay distinct: 🏅 is a rank-up, 🎉 a jackpot.
    it('falls back to the default promotion line, keeping its 🏅 marker', async () => {
        await writeGuildFiles('g-promo-down');
        const message = await generateRolePromotionMessage({
            ...announcementParams('g-promo-down'),
            roleName: 'Mouette',
        });

        expect(message).toContain('🏅');
        expect(message).not.toContain('🎉');
        expect(message).toContain('Mouette');
    });
});

describe('chatWithGemini, a failure inside the queue', () => {
    it('rejects with the original error object, so ask.ts can still detect a 503', async () => {
        const guildId = 'g-failure';
        await writeGuildFiles(guildId);

        // Shaped like the SDK error ask.ts inspects: it branches on status/message.
        const overloaded = Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
        fakeChat(() => {
            throw overloaded;
        });

        // Identity, not just message: a wrapped error would lose `status` and downgrade
        // the friendly "cerveau Google surchargé" reply to the generic one.
        await expect(ask(askParams(guildId))).rejects.toBe(overloaded);
    });

    it('still runs the next queued call for the same guild after a failure', async () => {
        const guildId = 'g-failure-then-ok';
        await writeGuildFiles(guildId);

        let call = 0;
        const sendMessage = vi.fn<(params: SendParams) => Promise<FakeResponse>>(() => {
            if (call++ === 0) return Promise.reject(new Error('boom'));
            return Promise.resolve({ text: 'Ça repart.' });
        });
        vi.spyOn(genai.chats, 'create').mockReturnValue({ sendMessage } as unknown as Chat);

        const failing = ask(askParams(guildId));
        const next = ask(askParams(guildId));

        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toMatchObject({ response: 'Ça repart.' });
    });
});

describe('chatWithGemini, a model that keeps asking for tools', () => {
    it('stops after MAX_TOOL_ROUNDS rounds instead of looping', async () => {
        const guildId = 'g-runaway';
        await writeGuildFiles(guildId);
        const chat = alwaysAsksForTools();

        await ask(askParams(guildId));

        // The opening message, plus one per bounded round.
        expect(chat.sendMessage).toHaveBeenCalledTimes(1 + MAX_TOOL_ROUNDS);
    });

    it('disarms the tools on the last round, so the model has to answer in text', async () => {
        const guildId = 'g-last-round';
        await writeGuildFiles(guildId);
        const chat = answersOnceDisarmed();

        const result = await ask(askParams(guildId));

        const calls = chat.sendMessage.mock.calls as Array<[SendParams]>;
        const lastParams = calls[calls.length - 1][0];

        // What separates a bounded loop from one that still answers.
        expect(lastParams.config).toBeDefined();
        expect(lastParams.config).not.toHaveProperty('tools');
        // A per-request config does not inherit the chat's, so this has to be restated.
        expect(lastParams.config?.systemInstruction).toContain('Tu es un bot de test.');

        expect(result.response).toBe('Réponse finale.');
    });

    it('reaches the caller as a real answer, not as the fallback message', async () => {
        const guildId = 'g-jackpot';
        await writeGuildFiles(guildId);
        answersOnceDisarmed();

        const message = await generateJackpotMessage({
            guildId,
            channelName: 'general',
            conversationContext: [],
            userName: 'Alice',
            amount: '1.00K',
            multiplier: 1000,
        });

        // The default starts with 🎉 JACKPOT: reaching the cap is not a failure.
        expect(message).toBe('Réponse finale.');
    });
});
