// Repo-owned vocabulary for a function-calling schema, so a tool declaration does not
// have to import an AI SDK to describe its own parameters. Only the two kinds actually
// in use; extend alongside the mapping each adapter keeps (app/llm/gemini/provider.ts)
// if a tool needs more.
export enum ToolParamType {
    OBJECT = 'OBJECT',
    STRING = 'STRING',
}

export type ToolParamSchema = {
    type: ToolParamType;
    description: string;
};

export type ToolFunctionDeclaration = {
    name: string;
    description: string;
    parameters: {
        type: ToolParamType;
        properties: Record<string, ToolParamSchema>;
        required: string[];
    };
};

/** One call the model asked for, normalized out of whatever shape its SDK used. */
export type ToolCall = {
    /**
     * Pairs a result with the call it answers. OpenAI-shaped APIs mint an id per call and
     * refuse a result without it; Gemini has none and matches on the name, so its adapter
     * puts the name here. Opaque to everything between the two adapters.
     */
    id: string;
    name: string;
    args: Record<string, string>;
};

/** What goes back to the model, carrying the `id` of the call it answers. */
export type ToolResult = {
    id: string;
    name: string;
    response: string;
};

/** A declaration and the code behind it, so no adapter has to know either. */
export type Tool = {
    declaration: ToolFunctionDeclaration;
    /** Never throws: a failure is an answer the model can read and work around. */
    execute: (args: Record<string, string>) => Promise<string>;
};

export type WeatherData = {
    city: string;
    country: string;
    temperature: number;
    feelsLike: number;
    tempMin: number;
    tempMax: number;
    humidity: number;
    pressure: number;
    description: string;
    windSpeed: number;
    clouds: number;
    visibility: number;
    uvIndex: number;
};
