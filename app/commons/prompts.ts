import { getFilePath, readTextFile, AllowedFiles } from './files.js';

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
        systemContent = await readTextFile(guildId, AllowedFiles.SYSTEM);
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
        memory = await readTextFile(guildId, AllowedFiles.MEMORY);
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

� SYSTÈME DE COQUILLAGES :
Les coquillages (🐚) sont la monnaie passive du serveur. Les membres en gagnent automatiquement de deux façons :
- **Message** : chaque message rapporte environ 10 coquillages (±10 % de variance), multiplié par la chaleur du salon (×1.0 à ×2.0 selon l'activité récente) et le streak journalier (×1.0 à ×2.0 selon les jours consécutifs actifs). Un même membre ne peut gagner qu'une fois toutes les 5 secondes.
- **Revenu passif** : quand un membre revient après une absence, il reçoit les coquillages accumulés pendant son inactivité. Le taux est plein (1 message-équivalent/heure) pendant les 24 premières heures d'absence, puis dégressif : environ ×0.5 à 48h, ×0.2 à 72h, quasi nul après une semaine. Le revenu passif est basé sur le gain par message du membre (upgrades inclus), sans multiplicateur heat ni streak.
- **Réaction** : quand quelqu'un pose une réaction sur un message, la personne qui réagit ET l'auteur du message reçoivent chacun 10 % du gain habituel par message.

Le **streak journalier** augmente chaque jour où le membre envoie au moins un message. Il donne un bonus progressif de ×1.0 (1er jour) jusqu'à ×2.0 (7 jours consécutifs ou plus). Un jour sans message remet le streak à zéro. Ce multiplicateur se combine avec la chaleur du salon : le bonus maximum est ×4.0 (×2 heat × ×2 streak).

- **Jackpot** : chaque message a 1 chance sur 1 000 de déclencher un jackpot, qui multiplie le gain du message par 1 000. Le jackpot est annoncé publiquement dans le salon.

Le gain augmente grâce aux upgrades achetables dans \`/shop\` :
- 🦦 **Loutres plongeuses** : augmente le gain de base par message (s'accélère avec les niveaux).
- 🐟 **Nageoires hydrodynamiques** : multiplie l'ensemble du gain.
- 🎒 **Sacs de récolte XXL** : multiplie également l'ensemble du gain (bonus plus élevé par niveau, mais coût bien plus important).

Les rôles Discord sont débloqués selon le pic historique de coquillages d'un membre, jamais perdu même si on en dépense.

Commandes liées aux coquillages :
- /shells [utilisateur] — affiche le profil d'un membre : solde, rang, gain par message, rôle actuel et prochain rôle à débloquer.
- /leaderboard [page] — classement du serveur par nombre de coquillages (10 par page).
- /shop [upgrade] [quantite] — boutique d'améliorations : sans argument affiche les upgrades disponibles et leur cout ; avec un upgrade permet d'en acheter des niveaux pour augmenter son gain par message.
- /heat — affiche la chaleur actuelle du salon et le multiplicateur de gain en cours.

════════════════════════════════════════

�📚 TA MÉMOIRE ACTUELLE :
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

export function createJackpotInstruction(
    userName: string,
    amount: string,
    multiplier: number,
): string {
    return `🎰 JACKPOT :
${userName} vient de déclencher le jackpot et gagne ${amount} 🐚 (×${multiplier} son income habituel) !

Génère un court message d'annonce épique (1-2 phrases max) pour ${userName}. Sois dramatique et enthousiaste ! Ne mets pas de balises <response> ou <memory>.`;
}
