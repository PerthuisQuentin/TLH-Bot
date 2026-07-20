import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Chat } from '@google/genai';
import { genai } from './gemini.ts';
import { ask, generateJackpotMessage, MAX_TOOL_ROUNDS } from './ask-gemini.ts';

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
