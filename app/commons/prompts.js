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
    timeZone: 'Europe/Paris',
  });
  const timeStr = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

  // Calculate UTC offset for Europe/Paris
  const parisTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
  );
  const utcTime = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetHours = Math.round((parisTime - utcTime) / (1000 * 60 * 60));
  const offsetStr = offsetHours >= 0 ? `+${offsetHours}` : `${offsetHours}`;

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
Nous sommes le ${dateStr} et il est ${timeStr} (Europe/Paris, UTC${offsetStr}).
Quand tu génères des dates ISO 8601 (pour les rappels par exemple), tu DOIS convertir l'heure locale en UTC.
Par exemple, si l'utilisateur demande un rappel à 14h30 heure locale et qu'on est en UTC${offsetStr}, la date ISO doit être ${offsetHours > 0 ? '13:30:00.000Z (14:30 - 1h)' : '15:30:00.000Z (14:30 + 1h)'}.
`.trim();
}

export const CONTEXT_MESSAGES_LIMIT = 50;

/**
 * Creates a user prompt with context and question
 * @param {string} channelName - The name of the Discord channel
 * @param {string} conversationContext - The formatted conversation history
 * @param {string} instruction - The instruction/question for the bot
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<string>} The formatted user prompt
 */
export async function createUserPrompt(
  channelName,
  conversationContext,
  instruction,
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

${instruction}
`.trim();
}

/**
 * Creates an instruction for asking a question
 * @param {string} userName - The name of the user asking the question
 * @param {string} userQuestion - The question asked by the user
 * @returns {string} The formatted instruction
 */
export function createQuestionInstruction(userName, userQuestion) {
  return `❓ QUESTION DE ${userName} :
${userQuestion}

Réponds à cette question en tenant compte de l'historique si pertinent.`;
}

/**
 * Creates an instruction for role promotion message
 * @param {string} userName - The user's display name
 * @param {string} roleName - The new role name
 * @returns {string} The formatted instruction
 */
export function createRolePromotionInstruction(userName, roleName) {
  return `🎉 PROMOTION DE RÔLE :
${userName} vient d'obtenir le rôle "${roleName}" grâce à son activité sur le serveur.

Génère un court message de félicitations (1-2 phrases max) pour ${userName}. Sois créatif et enthousiaste ! Ne mets pas de balises <response> ou <memory>.`;
}
