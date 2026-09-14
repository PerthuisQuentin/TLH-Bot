import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmErrorKind, LlmProviderId, type LlmProvider, type LlmTurn } from './types.ts';
import { generateJackpotMessage } from './jackpot.ts';
import { generateRolePromotionMessage } from './role-promotion.ts';

let mockProvider: LlmProvider;
vi.mock('./provider.ts', () => ({ getProvider: () => mockProvider }));

let dir: string;
let originalFilesDir: string | undefined;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tlh-llm-announcement-'));
    originalFilesDir = process.env.FILES_DIR;
    process.env.FILES_DIR = dir;
    // Prompt building reads both text files; writing them keeps the ENOENT fallbacks quiet.
    await writeFile(join(dir, 'g1-system.txt'), 'Tu es un bot de test.');
    await writeFile(join(dir, 'g1-memory.txt'), 'Rien pour le moment.');
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (originalFilesDir === undefined) delete process.env.FILES_DIR;
    else process.env.FILES_DIR = originalFilesDir;
    await rm(dir, { recursive: true, force: true });
});

/** Installs `reply` as the backend behind the engine. */
function fakeBackend(reply: () => LlmTurn): void {
    mockProvider = {
        id: LlmProviderId.GEMINI,
        model: 'fake-model',
        createSession: () => ({
            sendUserPrompt: () => Promise.resolve(reply()),
            sendToolResults: () => Promise.resolve(reply()),
        }),
        classifyError: () => LlmErrorKind.UNKNOWN,
    };
}

const params = {
    guildId: 'g1',
    channelName: 'general',
    conversationContext: [],
    userName: 'Alice',
};

// An announcement decorates an event that already happened, so it has to produce a line
// whatever the model does — these pin the fallback both announcement types share.
describe('announcements, when the model fails', () => {
    beforeEach(() => {
        fakeBackend(() => {
            throw new Error('Le modèle est tombé');
        });
    });

    it('falls back to the default jackpot line, keeping its 🎉 marker', async () => {
        const message = await generateJackpotMessage({
            ...params,
            amount: '1.00K',
            multiplier: 1000,
        });

        expect(message).toContain('🎉');
        expect(message).toContain('1.00K');
    });

    // The two markers must stay distinct: 🏅 is a rank-up, 🎉 a jackpot.
    it('falls back to the default promotion line, keeping its 🏅 marker', async () => {
        const message = await generateRolePromotionMessage({ ...params, roleName: 'Mouette' });

        expect(message).toContain('🏅');
        expect(message).not.toContain('🎉');
        expect(message).toContain('Mouette');
    });

    it('falls back when the model answers with nothing at all', async () => {
        fakeBackend(() => ({ text: '', toolCalls: [] }));

        const message = await generateRolePromotionMessage({ ...params, roleName: 'Mouette' });

        expect(message).toContain('🏅');
    });
});

describe('announcements, when the model answers', () => {
    it('passes the answer through instead of the default line', async () => {
        fakeBackend(() => ({ text: 'Bravo Alice !', toolCalls: [] }));

        const message = await generateJackpotMessage({
            ...params,
            amount: '1.00K',
            multiplier: 1000,
        });

        // The default starts with 🎉 JACKPOT, so this also proves the fallback stayed out.
        expect(message).toBe('Bravo Alice !');
    });

    it('tags its log line with the announcement kind', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        fakeBackend(() => ({ text: 'Bravo Alice !', toolCalls: [] }));

        await generateRolePromotionMessage({ ...params, roleName: 'Mouette' });

        const done = log.mock.calls
            .map(([line]) => String(line))
            .find((l) => l.startsWith('[LLM] Done'));
        expect(done).toContain('kind=promotion');
    });
});
