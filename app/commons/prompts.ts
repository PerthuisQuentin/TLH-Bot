import { fileStore, getFilePath, AllowedFiles } from '../storage/index.ts';
import type { ConversationMessage } from '../discord/types.ts';

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

    const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const utcTime = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetHours = Math.round((parisTime.getTime() - utcTime.getTime()) / (1000 * 60 * 60));
    const offsetStr = offsetHours >= 0 ? `+${offsetHours}` : `${offsetHours}`;

    let systemContent: string;
    try {
        systemContent = await fileStore.readText(guildId, AllowedFiles.SYSTEM);
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
`.trim();
}

/** How many messages callers fetch. What reaches the prompt can be fewer (a short or
 *  filtered channel) or one more (a trigger message appended to the fetched window), so
 *  the prompt counts what it actually holds rather than repeating this. */
export const CONTEXT_MESSAGES_LIMIT = 50;

function formatMessage(message: ConversationMessage, disambiguate: boolean): string {
    // The handle carries no '@': the only @-shaped token the model should ever
    // write is a real mention, `<@id>`.
    const name = disambiguate ? `${message.displayName} (${message.handle})` : message.displayName;
    const author = message.isBot ? `🤖 ${name}` : name;
    const date = message.sentAt.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
    });
    const time = message.sentAt.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return `👤 ${author} [ID:${message.userId}] • 🕐 ${date} ${time}\n${message.content}`;
}

/**
 * Display names collide, handles do not. Rather than spend tokens on a handle for
 * everyone, one is added only where two userIds share a name in this conversation.
 */
export function formatConversation(messages: ConversationMessage[]): string {
    const idsByName = new Map<string, Set<string>>();
    for (const message of messages) {
        const ids = idsByName.get(message.displayName) ?? new Set<string>();
        ids.add(message.userId);
        idsByName.set(message.displayName, ids);
    }

    return messages
        .map((message) =>
            formatMessage(message, (idsByName.get(message.displayName)?.size ?? 0) > 1),
        )
        .join('\n\n---\n\n');
}

export async function createUserPrompt(
    channelName: string,
    conversation: ConversationMessage[],
    instruction: string,
    guildId: string,
): Promise<string> {
    let memory = '';
    try {
        memory = await fileStore.readText(guildId, AllowedFiles.MEMORY);
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

🐚 SYSTÈME DE COQUILLAGES :
Les coquillages (🐚) sont la monnaie passive du serveur. Les membres en gagnent automatiquement de deux façons :
- **Message** : chaque message rapporte environ 10 coquillages (±10 % de variance), multiplié par la chaleur du salon (×1.0 à ×2.0 selon l'activité récente) et le streak journalier (×1.0 à ×2.0 selon les jours consécutifs actifs). Un même membre ne peut gagner qu'une fois toutes les 5 secondes.
- **Revenu passif** : quand un membre revient après une absence, il reçoit les coquillages accumulés pendant son inactivité. Le taux est plein (1 message-équivalent/heure) pendant les 24 premières heures d'absence, puis dégressif : environ ×0.5 à 48h, ×0.2 à 72h, quasi nul après une semaine. Le revenu passif est basé sur le gain par message du membre (upgrades inclus), sans multiplicateur heat ni streak.
- **Réaction** : quand quelqu'un pose une réaction sur un message, la personne qui réagit ET l'auteur du message reçoivent chacun 10 % du gain habituel par message.

Le **streak journalier** augmente chaque jour où le membre gagne des coquillages, en postant un message **ou** en réagissant à un message : une seule réaction dans la journée suffit à entretenir la série. Il donne un bonus progressif de ×1.0 (1er jour) jusqu'à ×2.0 (7 jours consécutifs ou plus). Une journée entière sans aucune activité fait repartir la série à 1. Ce multiplicateur se combine avec la chaleur du salon : le bonus maximum est ×4.0 (×2 heat × ×2 streak).

- **Jackpot** : chaque message a 1 chance sur 1 000 de déclencher un jackpot, qui rapporte 1 000 fois le gain de base par message, **en plus** du gain normal du message. Ni la chaleur du salon ni le streak ne s'appliquent au jackpot : il vaut la même chose pour tout le monde à gain par message égal. Le jackpot est annoncé publiquement dans le salon.

Le gain augmente grâce aux upgrades achetables dans \`/shop\` :
- 🦦 **Loutres plongeuses** : augmente le gain de base par message (s'accélère avec les niveaux).
- 🐟 **Nageoires hydrodynamiques** : multiplie l'ensemble du gain.
- 🎒 **Sacs de récolte XXL** : multiplie également l'ensemble du gain (bonus plus élevé par niveau, mais coût bien plus important).

Les rôles Discord se débloquent par paliers de coquillages sur le record historique (maxShells), pas sur le solde actuel : une fois un palier atteint, le rang est conservé même après des dépenses.

Commandes du bot (version concise) :
- /ask question:<texte> : poser une question au bot (aide, infos, explications).
- /shells [user] [public] : voir profil coquillages (solde, record, rang actuel, prochain palier/rang, gain par message, upgrades).
- /leaderboard [page] [sort] [public] : classement (10/page). sort=record (maxShells), current (solde), income (gain/msg).
- /shop [upgrade] [quantity] : voir la boutique ou acheter des niveaux pour augmenter le gain par message (et donc le passif).
- /heat [public] : afficher la chaleur du salon, le multiplicateur actif et les principaux contributeurs.
- /ping : vérifier rapidement que le bot répond.

Règle d'assistance :
- Si un membre demande comment utiliser une commande, répondre avec : but, syntaxe minimale, exemple concret, résultat attendu, et dans quel cas la recommander.

════════════════════════════════════════

📚 TA MÉMOIRE ACTUELLE :
${memory.trim() ? memory : 'Aucune mémoire enregistrée.'}

════════════════════════════════════════

📜 HISTORIQUE DES ${conversation.length} DERNIERS MESSAGES :
${conversation.length > 0 ? formatConversation(conversation) : 'Aucun message.'}

════════════════════════════════════════

${instruction}
`.trim();
}

export function createQuestionInstruction(userName: string, userQuestion: string): string {
    return `❓ QUESTION DE ${userName} :
${userQuestion}

Réponds à cette question en tenant compte de l'historique si pertinent.`;
}

export function createRolePromotionInstruction(userName: string, roleName: string): string {
    return `🏅 PROMOTION DE RÔLE :
${userName} vient d'obtenir le rôle "${roleName}" grâce à son activité sur le serveur.

Génère un court message de félicitations (1-2 phrases max) pour ${userName}. Sois créatif et enthousiaste !
Commence et termine ton message par 🏅, le marqueur réservé aux montées de rang. N'utilise jamais 🎉, qui signale un jackpot.`;
}

export function createNaturalChatInstruction(userName: string): string {
    return `💬 INTERVENTION SPONTANÉE :
${userName} vient de te mentionner, de parler de toi, ou tu réagis simplement à la conversation ci-dessus.

Réponds naturellement, comme si tu participais spontanément à la discussion — pas comme si on te posait une question formelle. Reste bref (1 à 3 phrases, sauf si le sujet le demande vraiment). Appuie-toi sur l'historique et ta mémoire si pertinent.`;
}

export function createJackpotInstruction(
    userName: string,
    amount: string,
    multiplier: number,
): string {
    return `🎉 JACKPOT :
${userName} vient de déclencher le jackpot et gagne ${amount} 🐚 (×${multiplier} son income habituel) !

Génère un court message d'annonce épique (1-2 phrases max) pour ${userName}. Sois dramatique et enthousiaste !
Commence et termine ton message par 🎉, le marqueur réservé aux jackpots. N'utilise jamais 🏅, qui signale une montée de rang.`;
}
