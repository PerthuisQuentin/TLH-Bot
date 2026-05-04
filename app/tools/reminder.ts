import { addReminder } from '../commons/reminder.js';
import { Type } from '@google/genai';
import type { ReminderObject } from '../commons/types.js';

export async function createReminder(
    guildId: string,
    userId: string,
    channelId: string,
    question: string,
    reminderDate: string,
): Promise<ReminderObject> {
    console.log(`Creating reminder for user ${userId} in guild ${guildId}`);
    return addReminder(guildId, userId, channelId, question, reminderDate);
}

export function formatReminderResponse(reminder: ReminderObject): string {
    const reminderDate = new Date(reminder.date);
    const now = new Date();
    const diffMinutes = Math.round(
        (reminderDate.getTime() - now.getTime()) / 60000,
    );

    return `✅ Rappel enregistré !
📝 Contenu: ${reminder.question}
⏰ Date: ${reminderDate.toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
    })}
⏱️ Dans ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
}

export const reminderToolOllama = {
    type: 'function',
    function: {
        name: 'create_reminder',
        description:
            "Crée un rappel pour l'utilisateur à une date et heure précises. Utilise cette fonction quand l'utilisateur demande à être rappelé de quelque chose. Tu dois calculer la date exacte du rappel en fonction de la demande de l'utilisateur (ex: 'dans 5 minutes', 'demain à 14h', 'le 10 mars à 9h30').",
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description:
                        'Le contenu du rappel, ce dont l\'utilisateur veut être rappelé (ex: "Lancer une machine", "Appeler le médecin")',
                },
                reminder_date: {
                    type: 'string',
                    description:
                        "La date et heure du rappel au format ISO 8601 (ex: '2026-03-06T14:30:00.000Z'). Tu dois calculer cette date en fonction de la demande de l'utilisateur et de l'heure actuelle.",
                },
            },
            required: ['question', 'reminder_date'],
        },
    },
};

export const reminderToolGemini = {
    name: 'create_reminder',
    description:
        "Crée un rappel pour l'utilisateur à une date et heure précises. Utilise cette fonction quand l'utilisateur demande à être rappelé de quelque chose. Tu dois calculer la date exacte du rappel en fonction de la demande de l'utilisateur et de l'heure actuelle. La date actuelle est le 6 mars 2026.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            question: {
                type: Type.STRING,
                description:
                    'Le contenu du rappel, ce dont l\'utilisateur veut être rappelé (ex: "Lancer une machine", "Appeler le médecin")',
            },
            reminder_date: {
                type: Type.STRING,
                description:
                    "La date et heure du rappel au format ISO 8601 (ex: '2026-03-06T14:30:00.000Z'). Tu dois calculer cette date en fonction de la demande de l'utilisateur et de l'heure actuelle.",
            },
        },
        required: ['question', 'reminder_date'],
    },
};
