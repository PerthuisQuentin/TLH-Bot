import { getProvider } from './provider.ts';
import type { LlmCallKind, LlmTurn } from './types.ts';
import { executeToolCall, toolDeclarations } from './tools/index.ts';
import type { ToolResult } from './tools/types.ts';
import { createSystemPrompt, createUserPrompt } from '../commons/prompts.ts';
import type { ConversationMessage } from '../discord/types.ts';
import { fileStore, AllowedFiles } from '../storage/index.ts';
import { parseResponse } from '../commons/response.ts';
import { enqueueForGuild } from '../commons/guild-queue.ts';

/**
 * Tool rounds before the model is made to answer. `get_weather` and `get_shells_profile`
 * are single-argument lookups: a legitimate answer resolves in one round, a couple more
 * if the model chains several cities or members instead of asking for all of them at
 * once. Past that it is not converging, and nothing used to stop it — a round of quota
 * burnt each time, and `/ask`'s deferred interaction expiring after 15 minutes with the
 * handler still looping.
 */
export const MAX_TOOL_ROUNDS = 5;

// The model writes tool arguments, so their length in the logs is capped.
const MAX_LOGGED_ARGS = 200;

/** `[LLM] Event | key=value | …`, skipping undefined values so an absent stat drops its key. */
function formatLogLine(event: string, fields: Record<string, string | number | undefined>): string {
    const pairs = Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`);
    return [`[LLM] ${event}`, ...pairs].join(' | ');
}

function formatCost(costUsd: number | undefined): string | undefined {
    return costUsd === undefined ? undefined : `$${costUsd.toFixed(6)}`;
}

export type ChatParams = {
    kind: LlmCallKind;
    guildId: string;
    channelName: string;
    conversationContext: ConversationMessage[];
    instruction: string;
    saveMemory?: boolean;
};

/**
 * The whole exchange, backend-agnostic: the provider only sends messages and reports
 * either text or tool calls, so prompts, the bounded tool loop and the memory protocol
 * live here once instead of once per backend.
 *
 * Reading `memory.txt` and writing it back afterwards must not straddle a concurrent
 * call for the same guild, or whichever write lands last silently discards the other's
 * update. `saveMemory` callers therefore run through `enqueueForGuild` so the read only
 * happens once the guild's turn arrives, never before an earlier call has finished
 * writing. Read-only callers (`saveMemory: false`) skip the queue: the write below is
 * structurally gated behind `saveMemory`, so they can never race one into existence.
 */
export async function chatWithLlm({
    kind,
    guildId,
    channelName,
    conversationContext,
    instruction,
    saveMemory = true,
}: ChatParams): Promise<{ response: string; memory: string }> {
    const run = async (): Promise<{ response: string; memory: string }> => {
        const provider = getProvider();
        const stats = { rounds: 0, tools: 0, costUsd: undefined as number | undefined };
        const addCost = (turn: LlmTurn): void => {
            if (turn.costUsd !== undefined) stats.costUsd = (stats.costUsd ?? 0) + turn.costUsd;
        };
        const summary = () => ({
            kind,
            provider: provider.id,
            model: provider.model,
            rounds: stats.rounds,
            tools: stats.tools,
            cost: formatCost(stats.costUsd),
            guildId,
        });

        let turn: LlmTurn;
        try {
            const systemPrompt = await createSystemPrompt(guildId);
            const userPrompt = await createUserPrompt(
                channelName,
                conversationContext,
                instruction,
                guildId,
            );

            const session = provider.createSession({ systemPrompt, tools: toolDeclarations });

            turn = await session.sendUserPrompt(userPrompt);
            addCost(turn);

            for (let round = 0; round < MAX_TOOL_ROUNDS && turn.toolCalls.length > 0; round++) {
                stats.rounds = round + 1;
                const results: ToolResult[] = [];

                for (const call of turn.toolCalls) {
                    results.push(await executeToolCall(call, { guildId }));
                    stats.tools++;
                    console.log(
                        formatLogLine('Tool', {
                            kind,
                            round: stats.rounds,
                            name: call.name,
                            args: JSON.stringify(call.args).slice(0, MAX_LOGGED_ARGS),
                            guildId,
                        }),
                    );
                }

                turn = await session.sendToolResults(results, {
                    disarmTools: round === MAX_TOOL_ROUNDS - 1,
                });
                addCost(turn);
            }
        } catch (error) {
            // Logged here, rethrown untouched: callers still branch on the original object.
            console.error(formatLogLine('Failed', summary()));
            throw error;
        }

        console.log(formatLogLine('Done', summary()));

        const { response: botResponse, memory: botMemory } = parseResponse(turn.text);

        if (saveMemory && botMemory) {
            try {
                await fileStore.writeText(guildId, AllowedFiles.MEMORY, botMemory);
                console.log(`[Memory] Updated | guildId=${guildId}`);
            } catch (error) {
                console.error(`[Memory] Error writing | guildId=${guildId}`, error);
            }
        }

        return { response: botResponse, memory: botMemory };
    };

    return saveMemory ? enqueueForGuild(guildId, run) : run();
}
