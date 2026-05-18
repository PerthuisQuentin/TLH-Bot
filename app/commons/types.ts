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
