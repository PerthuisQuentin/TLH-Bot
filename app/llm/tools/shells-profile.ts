import { ToolParamType, type Tool, type ToolFunctionDeclaration } from './types.ts';
import { getShellsProfile, type ShellsProfile } from '../../idle/shells-profile.ts';

/**
 * Same pieces as the `/shells` embed, plus `/shop` pricing per upgrade (next level cost,
 * levels affordable right now), laid out as one flowing text block for the model — enough
 * for it to advise a member on what to buy without a second tool.
 */
export async function formatShellsProfile(guildId: string, userId: string): Promise<string> {
    const profile = await getShellsProfile(guildId, userId, { includeShopPricing: true });

    return `Profil Coquillages de <@${userId}> :
Rang classement : ${profile.rankText}
Rôle actuel : ${profile.currentRoleText}
Prochain rôle : ${profile.nextRoleText}
Solde actuel : ${profile.balanceText}
Record historique : ${profile.maxShellsText}
Gain par message : ${profile.incomePerMessageText}
Gain par réaction : ${profile.incomePerReactionText}
${profile.streakText}
${reefBlock(profile)}Upgrades (niveau et gain actuels) :
${profile.upgradeLines.join('\n')}
Boutique — prochain niveau de chaque upgrade et ce que le solde actuel permet d'acheter dès maintenant :
${profile.upgradeShopLines.join('\n')}`;
}

/**
 * Omitted while the layer is locked, and said outright when it is not: the model invents a
 * plausible answer from an empty field, and inventing this one spoils the mechanic.
 */
function reefBlock(profile: ShellsProfile): string {
    if (!profile.coralUnlocked) {
        return 'Récif : pas encore débloqué pour ce joueur. Ne mentionne ni le corail ni le prestige, il ne les a pas découverts.\n';
    }
    return `Corail : ${profile.coralText}\n${profile.prestigeText}\n${profile.nextPrestigeText}\n`;
}

const shellsProfileDeclaration: ToolFunctionDeclaration = {
    name: 'get_shells_profile',
    description:
        "Récupère le profil Coquillages complet (solde, record, rang au classement, rôle actuel/suivant, gain par message et par réaction, streak, corail et prestiges, upgrades) d'un membre précis du serveur — le même résultat que la commande /shells — ainsi que les prix de la boutique /shop pour chacun de ses upgrades (coût du prochain niveau, gain que ça donnerait, et combien de niveaux son solde actuel permet d'acheter dès maintenant). Utilise OBLIGATOIREMENT cette fonction pour toute question liée aux coquillages (🐚) d'un membre précis : combien il/elle en a, son solde, son score, s'il/elle en a, son rang ou classement, ses upgrades, son rôle, son streak, son corail (🪸) ou ses prestiges — même formulée de façon informelle (\"il a combien de coquillages\", \"elle en a ?\", \"son rang c'est quoi\"), et même quand tu penses déjà connaître la réponse ou l'avoir donnée plus tôt dans la conversation. Sert aussi à conseiller un membre sur ses achats en boutique : quel upgrade prendre, combien de niveaux il peut se payer, s'il devrait plutôt économiser pour le prochain rôle — appelle-la aussi pour ce genre de question, même sans mention explicite du mot coquillage. N'invente et ne réutilise jamais un chiffre pour un autre membre : rappelle cette fonction séparément pour CHAQUE membre distinct visé, même juste après l'avoir appelée pour quelqu'un d'autre.",
    parameters: {
        type: ToolParamType.OBJECT,
        properties: {
            user_id: {
                type: ToolParamType.STRING,
                description:
                    "L'identifiant Discord du membre ciblé, tel qu'il apparaît entre crochets (ex: [ID:123456789]) dans l'historique de la conversation, ou dans une mention <@123456789>.",
            },
        },
        required: ['user_id'],
    },
};

export const shellsProfileTool: Tool = {
    declaration: shellsProfileDeclaration,
    execute: async (args, { guildId }) => {
        try {
            const userId = args.user_id;
            if (!userId) return "Erreur: aucun identifiant d'utilisateur fourni.";
            return await formatShellsProfile(guildId, userId);
        } catch (error) {
            return `Erreur lors de la récupération du profil coquillages: ${(error as Error).message}`;
        }
    },
};
