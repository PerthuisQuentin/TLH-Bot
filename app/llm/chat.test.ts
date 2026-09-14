import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmErrorKind, LlmProviderId, type LlmProvider, type LlmTurn } from './types.ts';
import type { ToolCall, ToolResult } from './tools/types.ts';
import { ask } from './ask.ts';
import { MAX_TOOL_ROUNDS } from './chat.ts';

// The engine is exercised against a fake backend: everything below is what any provider
// must survive, so none of it belongs in a backend-specific test file.
let mockProvider: LlmProvider;
vi.mock('./provider.ts', () => ({ getProvider: () => mockProvider }));

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-llm-chat-'));
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

/** One request, whichever of the two session methods carried it. */
type Send = { prompt?: string; results?: ToolResult[]; disarmTools?: boolean };
type FakeTurn = { text?: string; toolCalls?: ToolCall[]; costUsd?: number };
type FakeSend = ReturnType<typeof vi.fn<(send: Send) => Promise<LlmTurn>>>;

/** Installs `reply` as the backend, and hands back the spy that recorded every request. */
function fakeBackend(reply: (send: Send, call: number) => FakeTurn): FakeSend {
    let call = 0;
    const send = vi.fn(async (params: Send): Promise<LlmTurn> => {
        const turn = reply(params, call++);
        return { text: turn.text ?? '', toolCalls: turn.toolCalls ?? [], costUsd: turn.costUsd };
    });

    installBackend(send);
    return send;
}

function installBackend(send: (params: Send) => Promise<LlmTurn>): void {
    mockProvider = {
        id: LlmProviderId.GEMINI,
        model: 'fake-model',
        createSession: () => ({
            sendUserPrompt: (prompt) => send({ prompt }),
            sendToolResults: (results, { disarmTools }) => send({ results, disarmTools }),
        }),
        classifyError: () => LlmErrorKind.UNKNOWN,
    };
}

/** Unknown to the registry, which answers "Fonction inconnue" without any network — the
 *  loop is exercised, nothing else is. */
const TOOL_CALL: ToolCall = { id: 'call-1', name: 'unknown_tool', args: {} };
const WANTS_TOOL: FakeTurn = { toolCalls: [TOOL_CALL] };

/**
 * A model that never stops asking, whatever it is sent. Finite on purpose: it gives up
 * after 50 rounds, so removing the cap makes the test below fail on the call count
 * rather than hang the runner. A test that proves a bound must not need it to terminate.
 */
function alwaysAsksForTools(): FakeSend {
    return fakeBackend((_params, call) => (call < 50 ? WANTS_TOOL : { text: 'Trop tard.' }));
}

/** A faithful model: it can only emit a tool call while it still has one to call, so it
 *  answers in text exactly when the round that disarms it arrives. */
function answersOnceDisarmed(): FakeSend {
    return fakeBackend((params) => (params.disarmTools ? { text: 'Réponse finale.' } : WANTS_TOOL));
}

const askParams = (guildId: string) => ({
    guildId,
    channelName: 'general',
    conversationContext: [],
    userName: 'Alice',
    userQuestion: 'Il fait quel temps ?',
});

describe('chatWithLlm, nominal paths', () => {
    it('returns the answer and persists the memory half when no tool is called', async () => {
        const guildId = 'g-direct';
        await writeGuildFiles(guildId);
        const send = fakeBackend(() => ({
            text: 'Il fait beau.\n### [MÉMOIRE]\nAlice aime le soleil.',
        }));

        const result = await ask(askParams(guildId));

        expect(result.response).toBe('Il fait beau.');
        expect(send).toHaveBeenCalledTimes(1);
        expect(await readFile(join(dir, `${guildId}-memory.txt`), 'utf-8')).toBe(
            'Alice aime le soleil.',
        );
    });

    it('runs one tool round without degrading it, so the bound costs the happy path nothing', async () => {
        const guildId = 'g-one-round';
        await writeGuildFiles(guildId);
        const send = fakeBackend((_params, call) => (call === 0 ? WANTS_TOOL : { text: '20°C.' }));

        const result = await ask(askParams(guildId));

        expect(result.response).toBe('20°C.');
        expect(send).toHaveBeenCalledTimes(2);
        // Below the cap the tools stay in play, whatever the backend does with that.
        expect(send.mock.calls[1][0].disarmTools).toBe(false);
    });

    it('answers a tool call through the registry, so no backend owns the dispatch', async () => {
        const guildId = 'g-dispatch';
        await writeGuildFiles(guildId);
        const send = fakeBackend((_params, call) => (call === 0 ? WANTS_TOOL : { text: 'Bon.' }));

        await ask(askParams(guildId));

        expect(send.mock.calls[1][0].results).toEqual([
            { id: 'call-1', name: 'unknown_tool', response: 'Fonction inconnue: unknown_tool' },
        ]);
    });
});

describe('chatWithLlm, concurrent same-guild calls', () => {
    it("serializes two concurrent ask() calls so the second sees the first's memory write", async () => {
        const guildId = 'g-concurrent';
        await writeGuildFiles(guildId);

        let resolveFirst!: (turn: LlmTurn) => void;
        const gate = new Promise<LlmTurn>((resolve) => {
            resolveFirst = resolve;
        });
        let call = 0;
        const send = vi.fn<(params: Send) => Promise<LlmTurn>>(() =>
            call++ === 0
                ? gate
                : Promise.resolve({
                      text: 'B.\n### [MÉMOIRE]\nMemory from A seen.',
                      toolCalls: [],
                  }),
        );
        installBackend(send);

        const firstPromise = ask(askParams(guildId));
        const secondPromise = ask(askParams(guildId));

        // Real fs reads (system/memory prompt building) sit between the queue dequeue
        // and the first request, so wait for it rather than counting ticks.
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

        resolveFirst({ text: 'A.\n### [MÉMOIRE]\nMemory from A.', toolCalls: [] });
        await firstPromise;
        await secondPromise;

        // The load-bearing assertion: the second call's own prompt, built only once its
        // queue turn arrives, embeds the first call's freshly written memory rather than
        // the stale snapshot both calls would have read if unserialized.
        expect(send.mock.calls[1][0].prompt).toContain('Memory from A.');

        expect(await readFile(join(dir, `${guildId}-memory.txt`), 'utf-8')).toBe(
            'Memory from A seen.',
        );
    });
});

describe('chatWithLlm, a failure inside the queue', () => {
    it('rejects with the original error object, so ask.ts can still classify it', async () => {
        const guildId = 'g-failure';
        await writeGuildFiles(guildId);

        // Shaped like the SDK error the Gemini adapter inspects: it branches on status/message.
        const overloaded = Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
        fakeBackend(() => {
            throw overloaded;
        });

        // Identity, not just message: a wrapped error would lose `status` and downgrade
        // the friendly "cerveau surchargé" reply to the generic one.
        await expect(ask(askParams(guildId))).rejects.toBe(overloaded);
    });

    it('still runs the next queued call for the same guild after a failure', async () => {
        const guildId = 'g-failure-then-ok';
        await writeGuildFiles(guildId);

        let call = 0;
        installBackend(() => {
            if (call++ === 0) return Promise.reject(new Error('boom'));
            return Promise.resolve({ text: 'Ça repart.', toolCalls: [] });
        });

        const failing = ask(askParams(guildId));
        const next = ask(askParams(guildId));

        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toMatchObject({ response: 'Ça repart.' });
    });
});

describe('chatWithLlm, a model that keeps asking for tools', () => {
    it('stops after MAX_TOOL_ROUNDS rounds instead of looping', async () => {
        const guildId = 'g-runaway';
        await writeGuildFiles(guildId);
        const send = alwaysAsksForTools();

        await ask(askParams(guildId));

        // The opening message, plus one per bounded round.
        expect(send).toHaveBeenCalledTimes(1 + MAX_TOOL_ROUNDS);
    });

    it('disarms the tools on the last round only, so the model has to answer in text', async () => {
        const guildId = 'g-last-round';
        await writeGuildFiles(guildId);
        const send = answersOnceDisarmed();

        const result = await ask(askParams(guildId));

        const disarmed = send.mock.calls.map(([params]) => params.disarmTools);
        // What separates a bounded loop from one that still answers: every round below
        // the cap keeps the tools, and exactly the last one drops them.
        expect(disarmed).toEqual([
            undefined,
            ...Array<boolean>(MAX_TOOL_ROUNDS - 1).fill(false),
            true,
        ]);
        expect(result.response).toBe('Réponse finale.');
    });
});

describe('chatWithLlm, logs', () => {
    /** The `[LLM] <event>` lines written so far, from whichever console method carries them. */
    function llmLines(spy: { mock: { calls: unknown[][] } }, event: string): string[] {
        return spy.mock.calls
            .map(([line]) => String(line))
            .filter((line) => line.startsWith(`[LLM] ${event} `));
    }

    it('logs each tool call, then one summary naming the provider', async () => {
        const guildId = 'g-log-tools';
        await writeGuildFiles(guildId);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        fakeBackend((_params, call) =>
            call === 0
                ? { toolCalls: [TOOL_CALL, { ...TOOL_CALL, id: 'call-2', args: { city: 'Lyon' } }] }
                : { text: 'Bon.' },
        );

        await ask(askParams(guildId));

        const tools = llmLines(log, 'Tool');
        expect(tools).toHaveLength(2);
        expect(tools[1]).toContain('round=1');
        expect(tools[1]).toContain('name=unknown_tool');
        expect(tools[1]).toContain('args={"city":"Lyon"}');
        // Without it, a tool line cannot be matched to its summary when guilds overlap.
        expect(tools[1]).toContain(`guildId=${guildId}`);

        const [done] = llmLines(log, 'Done');
        expect(done).toBe(
            `[LLM] Done | kind=ask | provider=gemini | model=fake-model | rounds=1 | tools=2 | guildId=${guildId}`,
        );
    });

    it('sums the cost over every round when the backend reports one', async () => {
        const guildId = 'g-log-cost';
        await writeGuildFiles(guildId);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        fakeBackend((_params, call) =>
            call === 0 ? { ...WANTS_TOOL, costUsd: 0.001 } : { text: 'Bon.', costUsd: 0.0005 },
        );

        await ask(askParams(guildId));

        expect(llmLines(log, 'Done')[0]).toContain('cost=$0.001500');
    });

    it('drops the cost key when no round reported one, rather than printing zero', async () => {
        const guildId = 'g-log-no-cost';
        await writeGuildFiles(guildId);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        fakeBackend(() => ({ text: 'Bon.' }));

        await ask(askParams(guildId));

        const [done] = llmLines(log, 'Done');
        expect(done).toContain('rounds=0 | tools=0');
        expect(done).not.toContain('cost=');
        expect(llmLines(log, 'Tool')).toHaveLength(0);
    });

    it('logs a failure before rethrowing the very same error', async () => {
        const guildId = 'g-log-failed';
        await writeGuildFiles(guildId);
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = new Error('boom');
        fakeBackend(() => {
            throw boom;
        });

        await expect(ask(askParams(guildId))).rejects.toBe(boom);

        expect(llmLines(errorLog, 'Failed')[0]).toBe(
            `[LLM] Failed | kind=ask | provider=gemini | model=fake-model | rounds=0 | tools=0 | guildId=${guildId}`,
        );
    });
});
