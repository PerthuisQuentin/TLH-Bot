export function parseResponse(fullResponse: string): {
    response: string;
    memory: string;
} {
    const memoryMarker = '### [MÉMOIRE]';
    const markerIndex = fullResponse.indexOf(memoryMarker);

    if (markerIndex !== -1) {
        const response = fullResponse.substring(0, markerIndex).trim();
        const memory = fullResponse
            .substring(markerIndex + memoryMarker.length)
            .trim();
        return { response, memory };
    }

    return { response: fullResponse, memory: '' };
}
