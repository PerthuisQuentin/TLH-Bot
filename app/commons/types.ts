import { z } from 'zod';

export type ShellsRoleConfig = {
    roleId: string;
    threshold: string;
};

export type GuildConfig = {
    noAskChannels?: string[];
    noShellChannels?: string[];
    noChatChannels?: string[];
    shellsRoles?: ShellsRoleConfig[];
    chatEnabled?: boolean;
    chatNicknames?: string[];
    chatIndirectProbability?: number;
    chatRandomProbability?: number;
};

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const ShellsRoleConfigSchema = z.object({
    roleId: z.string(),
    threshold: z.string(),
});

export const GuildConfigSchema = z.object({
    noAskChannels: z.array(z.string()).optional(),
    noShellChannels: z.array(z.string()).optional(),
    noChatChannels: z.array(z.string()).optional(),
    shellsRoles: z.array(ShellsRoleConfigSchema).optional(),
    chatEnabled: z.boolean().optional(),
    chatNicknames: z.array(z.string()).optional(),
    chatIndirectProbability: z.number().min(0).max(1).optional(),
    chatRandomProbability: z.number().min(0).max(1).optional(),
});
