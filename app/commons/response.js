/**
 * Parses the bot response to extract the actual response and memory section
 * @param {string} fullResponse - The full response from the LLM
 * @returns {Object} Object with { response: string, memory: string }
 */
export function parseResponse(fullResponse) {
  const memoryMarker = '### [MÉMOIRE]';
  const markerIndex = fullResponse.indexOf(memoryMarker);

  if (markerIndex !== -1) {
    const response = fullResponse.substring(0, markerIndex).trim();
    const memory = fullResponse
      .substring(markerIndex + memoryMarker.length)
      .trim();
    return { response, memory };
  }

  // Fallback if marker not found
  return { response: fullResponse, memory: '' };
}
