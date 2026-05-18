import { z } from 'zod';

export type ReminderObject = {
    id: string;
    userId: string;
    channelId: string;
    date: string;
    question: string;
    createdAt: string;
}

export type ShellsUser = {
    userId: string;
    shells: number;
    maxShells: number;
    shellsPerMessage: number;
}

export type ShellsRoleConfig = {
    roleId: string;
    threshold: number;
}

export type GuildConfig = {
    noAskChannels?: string[];
    noShellChannels?: string[];
    shellsRoles?: ShellsRoleConfig[];
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const ReminderObjectSchema = z.object({
    id: z.string(),
    userId: z.string(),
    channelId: z.string(),
    date: z.string(),
    question: z.string(),
    createdAt: z.string(),
});

export const ShellsUserSchema = z.object({
    userId: z.string(),
    shells: z.number(),
    maxShells: z.number(),
    shellsPerMessage: z.number(),
});

export const ShellsRoleConfigSchema = z.object({
    roleId: z.string(),
    threshold: z.number(),
});

export const GuildConfigSchema = z.object({
    noAskChannels: z.array(z.string()).optional(),
    noShellChannels: z.array(z.string()).optional(),
    shellsRoles: z.array(ShellsRoleConfigSchema).optional(),
});
