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
    shells: string;
    maxShells: string;
    shellsPerMessage: string;
    streak?: number;
    lastStreakDate?: string;
    lastActiveAt?: string;
}

export type ShellsRoleConfig = {
    roleId: string;
    threshold: string;
}

export type GuildConfig = {
    noAskChannels?: string[];
    noShellChannels?: string[];
    shellsRoles?: ShellsRoleConfig[];
}

export type UserUpgrades = {
    userId: string;
    divingOtters: number;
    hydrodynamicFlippers: number;
    harvestBags: number;
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
    shells: z.string(),
    maxShells: z.string(),
    shellsPerMessage: z.string(),
    streak: z.number().optional(),
    lastStreakDate: z.string().optional(),
    lastActiveAt: z.string().optional(),
});

export const ShellsRoleConfigSchema = z.object({
    roleId: z.string(),
    threshold: z.string(),
});

export const GuildConfigSchema = z.object({
    noAskChannels: z.array(z.string()).optional(),
    noShellChannels: z.array(z.string()).optional(),
    shellsRoles: z.array(ShellsRoleConfigSchema).optional(),
});

export const UserUpgradesSchema = z.object({
    userId: z.string(),
    divingOtters: z.number(),
    hydrodynamicFlippers: z.number(),
    harvestBags: z.number(),
});
