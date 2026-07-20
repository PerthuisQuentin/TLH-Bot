// Repo-owned vocabulary for a function-calling schema, so a tool declaration does not
// have to import an AI SDK to describe its own parameters. Only the two kinds actually
// in use; extend alongside the mapping in app/gemini/ask-gemini.ts if a tool needs more.
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
