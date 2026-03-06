import { getFilePath, readFileContent, AllowedFiles } from './files.js';

/**
 * Creates the system prompt with current date and time
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<string>} The system prompt
 */
export async function createSystemPrompt(guildId) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Read system prompt from file
  let systemContent = '';
  try {
    systemContent = await readFileContent(guildId, AllowedFiles.SYSTEM);
  } catch (error) {
    console.error(
      `Error reading system file (${getFilePath(
        guildId,
        AllowedFiles.SYSTEM,
      )}):`,
      error,
    );
    // Fallback to a basic prompt if file cannot be read
    systemContent = "Tu es Gérard, le bot du serveur Discord 'The Local Host'.";
  }

  return `
${systemContent}

INFORMATIONS TEMPORELLES :
Nous sommes le ${dateStr} et il est ${timeStr}.
`.trim();
}

export const CONTEXT_MESSAGES_LIMIT = 50;

/**
 * Creates a user prompt with context and question
 * @param {string} channelName - The name of the Discord channel
 * @param {string} conversationContext - The formatted conversation history
 * @param {string} userName - The name of the user asking the question
 * @param {string} userQuestion - The question asked by the user
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<string>} The formatted user prompt
 */
export async function createUserPrompt(
  channelName,
  conversationContext,
  userName,
  userQuestion,
  guildId,
) {
  // Read memory from file
  let memory = '';
  try {
    memory = await readFileContent(guildId, AllowedFiles.MEMORY);
  } catch (error) {
    console.error(
      `Error reading memory file (${getFilePath(
        guildId,
        AllowedFiles.MEMORY,
      )}):`,
      error,
    );
    // Continue without memory if it fails
  }

  return `
📍 CONTEXTE :
Canal : #${channelName}

════════════════════════════════════════

📚 TA MÉMOIRE ACTUELLE :
${memory.trim() ? memory : 'Aucune mémoire enregistrée.'}

════════════════════════════════════════

📜 HISTORIQUE DES ${CONTEXT_MESSAGES_LIMIT} DERNIERS MESSAGES :
${conversationContext}

════════════════════════════════════════

❓ QUESTION DE ${userName} :
${userQuestion}

Réponds à cette question en tenant compte de l'historique si pertinent.
`.trim();
}
