import { ToolParamType, type Tool, type ToolFunctionDeclaration } from './types.ts';
import { getShellsRolesConfig } from '../../idle/shells-roles.ts';
import { bnFromJSON, formatBigNum } from '../../idle/core/big-number.ts';

/** One line per configured role, ascending by threshold — same order `getShellsRolesConfig` returns. */
export async function formatRoleThresholds(guildId: string): Promise<string> {
    const roles = await getShellsRolesConfig(guildId);

    if (roles.length === 0) {
        return "Aucun rôle Coquillages n'est configuré sur ce serveur.";
    }

    const lines = roles.map(
        (role) => `<@&${role.roleId}> — à partir de ${formatBigNum(bnFromJSON(role.threshold))} 🐚`,
    );

    return `Paliers de rôles Coquillages (sur le record historique, pas le solde actuel), par ordre croissant :\n${lines.join('\n')}`;
}

const roleThresholdsDeclaration: ToolFunctionDeclaration = {
    name: 'get_role_thresholds',
    description:
        'Liste tous les paliers de rôles Coquillages du serveur avec le nombre de coquillages requis pour chacun (basé sur le record historique maxShells, pas le solde actuel). Utilise cette fonction pour toute question générale sur les rôles/paliers, sans viser un membre précis : quels sont les rôles disponibles, combien il faut pour tel rôle, quel est le palier le plus haut, etc. Pour savoir où en est un membre précis par rapport à ces paliers (son rôle actuel, le prochain, combien il lui manque), utilise plutôt get_shells_profile.',
    parameters: {
        type: ToolParamType.OBJECT,
        properties: {},
        required: [],
    },
};

export const roleThresholdsTool: Tool = {
    declaration: roleThresholdsDeclaration,
    execute: async (args, { guildId }) => {
        try {
            return await formatRoleThresholds(guildId);
        } catch (error) {
            return `Erreur lors de la récupération des paliers de rôles: ${(error as Error).message}`;
        }
    },
};
