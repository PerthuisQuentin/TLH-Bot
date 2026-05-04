import { readdir } from 'fs/promises';
import {
    readJsonFile,
    writeJsonFile,
    AllowedFiles,
    getFilesDirectory,
} from './files.js';
import type { ReminderObject } from './types.js';

export async function getAllGuildIdsWithReminders(): Promise<string[]> {
    const filesDir = getFilesDirectory();
    const files = await readdir(filesDir);
    const reminderFiles = files.filter((f) => f.endsWith('-reminder.json'));
    return reminderFiles.map((f) => f.replace('-reminder.json', ''));
}

export async function getExpiredReminders(
    guildId: string,
): Promise<ReminderObject[]> {
    const reminders = await readJsonFile<ReminderObject[]>(
        guildId,
        AllowedFiles.REMINDER,
        [],
    );
    const now = new Date();
    return reminders.filter((r) => new Date(r.date) <= now);
}

export async function addReminder(
    guildId: string,
    userId: string,
    channelId: string,
    question: string,
    date: Date | string,
): Promise<ReminderObject> {
    if (!guildId || typeof guildId !== 'string') {
        throw new Error('guildId is required');
    }
    if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required');
    }
    if (!channelId || typeof channelId !== 'string') {
        throw new Error('channelId is required');
    }
    if (!question || typeof question !== 'string') {
        throw new Error('question is required');
    }

    const isoDate = date instanceof Date ? date.toISOString() : date;

    if (!isoDate || isNaN(Date.parse(isoDate))) {
        throw new Error('Invalid date format. Expected ISO string or Date object');
    }

    const reminders = await readJsonFile<ReminderObject[]>(
        guildId,
        AllowedFiles.REMINDER,
        [],
    );

    const userReminders = reminders.filter((r) => r.userId === userId);
    if (userReminders.length >= 100) {
        throw new Error('Limite de rappels atteinte (100 maximum par utilisateur)');
    }

    const reminder: ReminderObject = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        channelId,
        date: isoDate,
        question,
        createdAt: new Date().toISOString(),
    };
    reminders.push(reminder);
    await writeJsonFile(guildId, AllowedFiles.REMINDER, reminders);

    return reminder;
}

export async function deleteReminder(
    guildId: string,
    reminderId: string,
): Promise<ReminderObject | null> {
    if (!guildId || typeof guildId !== 'string') {
        throw new Error('guildId is required');
    }
    if (!reminderId || typeof reminderId !== 'string') {
        throw new Error('reminderId is required');
    }

    const reminders = await readJsonFile<ReminderObject[]>(
        guildId,
        AllowedFiles.REMINDER,
        [],
    );
    const reminderIndex = reminders.findIndex((r) => r.id === reminderId);

    if (reminderIndex === -1) {
        return null;
    }

    const deletedReminder = reminders.splice(reminderIndex, 1)[0];
    await writeJsonFile(guildId, AllowedFiles.REMINDER, reminders);

    return deletedReminder;
}
