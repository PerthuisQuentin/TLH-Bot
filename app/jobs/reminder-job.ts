import {
    getAllGuildIdsWithReminders,
    getExpiredReminders,
    deleteReminder,
} from '../commons/reminder.js';
import { ask } from '../gemini/ask-gemini.js';
import { DiscordRequest } from '../commons/utils.js';

export async function processReminders(): Promise<void> {
    try {
        const guildIds = await getAllGuildIdsWithReminders();

        for (const guildId of guildIds) {
            const expiredReminders = await getExpiredReminders(guildId);

            for (const reminder of expiredReminders) {
                try {
                    console.log(
                        `[Reminder] Processing | reminderId=${reminder.id} | userId=${reminder.userId}`,
                    );

                    const result = await ask({
                        guildId,
                        userId: reminder.userId,
                        channelId: reminder.channelId,
                        channelName: 'rappel',
                        conversationContext: '',
                        userName: 'Système de rappel',
                        userQuestion: `[RAPPEL AUTOMATIQUE] L'utilisateur <@${reminder.userId}> avait demandé un rappel pour: "${reminder.question}". Réponds-lui brièvement pour lui rappeler ce qu'il avait demandé. Mentionne-le dans ta réponse.`,
                    });

                    await DiscordRequest(`channels/${reminder.channelId}/messages`, {
                        method: 'POST',
                        body: { content: result.response },
                    });

                    await deleteReminder(guildId, reminder.id);

                    console.log(`[Reminder] Processed | reminderId=${reminder.id}`);
                } catch (error) {
                    console.error(
                        `[Reminder] Error processing | reminderId=${reminder.id}`,
                        error,
                    );
                }
            }
        }
    } catch (error) {
        console.error('[Reminder] Error in job', error);
    }
}

export function startReminderJob(): void {
    console.log('[ReminderJob] Starting reminder job (runs every minute)');
    processReminders();
    setInterval(processReminders, 60 * 1000);
}
