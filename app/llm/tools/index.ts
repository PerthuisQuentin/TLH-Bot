import { weatherTool } from './weather.ts';
import type { Tool, ToolCall, ToolFunctionDeclaration, ToolResult } from './types.ts';

/** Every tool the model may call. Adding one here is all it takes; no adapter changes. */
const tools: Tool[] = [weatherTool];

const byName = new Map<string, Tool>(tools.map((tool) => [tool.declaration.name, tool]));

export const toolDeclarations: ToolFunctionDeclaration[] = tools.map((tool) => tool.declaration);

/**
 * Never throws and never returns nothing: a model that invents a function name still gets
 * an answer it can react to, which is what keeps the tool loop converging on text.
 */
export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
    const tool = byName.get(call.name);

    if (!tool) {
        return { id: call.id, name: call.name, response: `Fonction inconnue: ${call.name}` };
    }

    return { id: call.id, name: call.name, response: await tool.execute(call.args) };
}
