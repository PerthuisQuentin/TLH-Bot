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
- **Message** : chaque message rapporte environ 10 coquillages (±10 % de variance), multiplié par la chaleur du salon (×1.0 à ×2.0 selon l'activité récente) et les stries de croissance (×1.0 à ×2.0 selon les jours consécutifs actifs). Un même membre ne peut gagner qu'une fois toutes les 5 secondes.
- **Revenu passif** : quand un membre revient après une absence, il reçoit les coquillages accumulés pendant son inactivité. Le taux est plein (1 message-équivalent/heure) pendant les 24 premières heures d'absence, puis dégressif : environ ×0.5 à 48h, ×0.2 à 72h, quasi nul après une semaine. Le revenu passif est basé sur le gain par message du membre (upgrades inclus), sans multiplicateur de chaleur ni de stries.
- **Réaction** : quand quelqu'un pose une réaction sur un message, la personne qui réagit ET l'auteur du message reçoivent chacun 10 % du gain habituel par message.

Les **stries de croissance** : une strie s'ajoute chaque jour où le membre gagne des coquillages, en postant un message **ou** en réagissant à un message : une seule réaction dans la journée suffit à entretenir la série. Elles donnent un bonus progressif de ×1.0 (1er jour) jusqu'à ×2.0 (7 jours consécutifs ou plus). Une journée entière sans aucune activité fait repartir la série à 1. Ce multiplicateur se combine avec la chaleur du salon : le bonus maximum est ×4.0 (×2 chaleur × ×2 stries).

- **Jackpot** : chaque message a 1 chance sur 1 000 de déclencher un jackpot, qui rapporte 1 000 fois le gain de base par message, **en plus** du gain normal du message. Ni la chaleur du salon ni les stries ne s'appliquent au jackpot : il vaut la même chose pour tout le monde à gain par message égal. Le jackpot est annoncé publiquement dans le salon.

Le gain augmente grâce aux upgrades achetables dans \`/shop page:Coquillages\` :
- 🦦 **Loutres plongeuses** : augmente le gain de base par message (s'accélère avec les niveaux).
- 🐟 **Nageoires hydrodynamiques** : multiplie l'ensemble du gain.
- 🎒 **Sacs de récolte XXL** : multiplie également l'ensemble du gain (bonus plus élevé par niveau, mais coût bien plus important).

Le rayon \`/shop page:Trésors\` rassemble les achats uniques, qui débloquent quelque chose au lieu d'augmenter le gain :
- 🌱 **Bouture de corail** : achat unique à 100 000 🐚, ne rapporte aucun gain. Elle ouvre la suite du jeu. Une fois achetée elle disparaît de la boutique et du profil \`/shells\` : il n'y a plus rien à en faire, ne conseille donc jamais de la racheter.

🪸 PRESTIGE ET CORAIL :
**Contenu à ne pas divulguer.** Tout ce qui suit est verrouillé tant que le membre n'a pas acheté 🌱 Bouture de corail. Pour un membre qui ne l'a pas, ne mentionne ni le corail, ni le prestige, ni le récif — ni la commande \`/prestige\`, ni le rayon \`/shop page:Corail\`, qui les nomment — même s'il pose la question de ce qui vient après : dis simplement que la boutique réserve encore une surprise. L'outil \`get_shells_profile\` t'indique pour chaque membre si le récif est débloqué.

Quand la progression ralentit, \`/prestige\` échange le cycle en cours contre du **corail** (🪸), la monnaie permanente. Les loutres prennent leur retraite et la récolte se dépose sur le récif.
- **Ce qui est remis à zéro** : le solde de coquillages et les trois upgrades de récolte (loutres, nageoires, sacs).
- **Ce qui est conservé** : le record historique, les rôles Discord, les stries de croissance, la bouture, le corail et les upgrades de corail. Un prestige ne fait donc perdre aucun rang ni aucun rôle, c'est ce qui le rend sans risque.
- **Combien de corail** : cela dépend du record de coquillages atteint **depuis le dernier prestige**, pas du solde courant ni du record historique. Il faut 1 million de coquillages de record sur le cycle pour le premier 🪸, et la progression est volontairement sous-linéaire : tenir deux fois plus longtemps rapporte nettement moins que le double. Prestiger trop tôt ralentit, mais ne casse jamais rien.
- \`/prestige\` seul affiche un aperçu et ne change rien ; \`/prestige confirmer:true\` exécute l'échange. Sous 1 🪸, la commande refuse et indique ce qui manque, et sans la bouture elle renvoie vers la boutique.

Le corail s'achète dans \`/shop page:Corail\` :
- 🫧 **Récif nourricier** : multiplie définitivement le gain par message, x2 par niveau et davantage tous les 5 niveaux. Coûte 1, 4, 16, 64, 256 🪸.
- 🪷 **Polypes bâtisseurs** : +10% de corail à chaque prestige, par niveau. Coûte 1, 2, 4, 8, 16 🪸, donc bien moins cher que le récif : c'est l'achat d'appoint entre deux niveaux de récif.

Ces deux upgrades survivent à tous les prestiges.

Les rôles Discord se débloquent par paliers de coquillages sur le record historique (maxShells), pas sur le solde actuel : une fois un palier atteint, le rang est conservé même après des dépenses. Un prestige ne touche pas ce record.

Commandes du bot (version concise) :
- /ask question:<texte> : poser une question au bot (aide, infos, explications).
- /shells [user] [public] : voir profil coquillages (solde, record, rang actuel, prochain palier/rang, gain par message, upgrades).
- /leaderboard [page] [sort] [public] : classement (10/page). sort=record (maxShells), current (solde), income (gain/msg). Le classement porte sur les coquillages.
- /shop [upgrade] [page] [quantity] : voir la boutique ou acheter des niveaux. page=Coquillages par défaut ; les autres rayons n'existent que pour qui les a débloqués.
- /heat [public] : afficher la chaleur du salon, le multiplicateur actif et les principaux contributeurs.
- /ping : vérifier rapidement que le bot répond.

Capacités directement en conversation, sans commande : tu peux consulter le profil coquillages de n'importe quel membre (solde, rang, upgrades, et ce que la boutique lui permet d'acheter dès maintenant), le classement du serveur, et les paliers de rôles configurés. Utilise-les pour répondre avec des chiffres exacts plutôt que d'estimer, et pour conseiller un membre sur son prochain achat en boutique si on te le demande.

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
