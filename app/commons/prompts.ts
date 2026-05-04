import { getFilePath, readFileContent, AllowedFiles } from './files.js';

export async function createSystemPrompt(guildId: string): Promise<string> {
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

    const parisTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }),
    );
    const utcTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'UTC' }),
    );
    const offsetHours = Math.round(
        (parisTime.getTime() - utcTime.getTime()) / (1000 * 60 * 60),
    );
    const offsetStr = offsetHours >= 0 ? `+${offsetHours}` : `${offsetHours}`;

    let systemContent = '';
    try {
        systemContent = await readFileContent(guildId, AllowedFiles.SYSTEM);
    } catch (error) {
        console.error(
            `Error reading system file (${getFilePath(guildId, AllowedFiles.SYSTEM)}):`,
            error,
        );
        systemContent = "Tu es Gérard, le bot du serveur Discord 'The Local Host'.";
    }

    return `
${systemContent}

INFORMATIONS TEMPORELLES :
Nous sommes le ${dateStr} et il est ${timeStr} (Europe/Paris, UTC${offsetStr}).
Quand tu génères des dates ISO 8601 (pour les rappels par exemple), tu DOIS convertir l'heure locale en UTC.
Par exemple, si l'utilisateur demande un rappel à 14h30 heure locale et qu'on est en UTC${offsetHours > 0 ? '13:30:00.000Z (14:30 - 1h)' : '15:30:00.000Z (14:30 + 1h)'}.
`.trim();
}

export const CONTEXT_MESSAGES_LIMIT = 50;

export async function createUserPrompt(
    channelName: string,
    conversationContext: string,
    instruction: string,
    guildId: string,
): Promise<string> {
    let memory = '';
    try {
        memory = await readFileContent(guildId, AllowedFiles.MEMORY);
    } catch (error) {
        console.error(
            `Error reading memory file (${getFilePath(guildId, AllowedFiles.MEMORY)}):`,
            error,
        );
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

export function createQuestionInstruction(
    userName: string,
    userQuestion: string,
): string {
    return `❓ QUESTION DE ${userName} :
${userQuestion}

Réponds à cette question en tenant compte de l'historique si pertinent.`;
}

export function createRolePromotionInstruction(
    userName: string,
    roleName: string,
): string {
    return `🎉 PROMOTION DE RÔLE :
${userName} vient d'obtenir le rôle "${roleName}" grâce à son activité sur le serveur.

Génère un court message de félicitations (1-2 phrases max) pour ${userName}. Sois créatif et enthousiaste ! Ne mets pas de balises <response> ou <memory>.`;
}
