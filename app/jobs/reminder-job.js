import {
  getAllGuildIdsWithReminders,
  getExpiredReminders,
  deleteReminder,
} from '../commons/reminder.js';
import { ask } from '../gemini/ask-gemini.js';
import { DiscordRequest } from '../commons/utils.js';

/**
 * Processes all expired reminders across all guilds
 * - Finds all guilds with reminder files
 * - For each guild, finds expired reminders
 * - Calls ask-gemini to generate a reminder message
 * - Sends the message to the appropriate Discord channel
 * - Deletes the processed reminder
 */
export async function processReminders() {
  try {
    const guildIds = await getAllGuildIdsWithReminders();

    for (const guildId of guildIds) {
      const expiredReminders = await getExpiredReminders(guildId);

      for (const reminder of expiredReminders) {
        try {
          console.log(
            `[Reminder] Processing | reminderId=${reminder.id} | userId=${reminder.userId}`,
          );

          // Call ask to generate a reminder response
          const result = await ask({
            guildId,
            userId: reminder.userId,
            channelId: reminder.channelId,
            channelName: 'rappel',
            conversationContext: '',
            userName: 'Système de rappel',
            userQuestion: `[RAPPEL AUTOMATIQUE] L'utilisateur <@${reminder.userId}> avait demandé un rappel pour: "${reminder.question}". Réponds-lui brièvement pour lui rappeler ce qu'il avait demandé. Mentionne-le dans ta réponse.`,
          });

          // Send message to Discord channel
          await DiscordRequest(`channels/${reminder.channelId}/messages`, {
            method: 'POST',
            body: {
              content: result.response,
            },
          });

          // Delete the processed reminder
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

/**
 * Starts the reminder processing job
 * Runs every minute to check for expired reminders
 */
export function startReminderJob() {
  console.log('[ReminderJob] Starting reminder job (runs every minute)');

  // Run immediately on start
  processReminders();

  // Then run every minute
  setInterval(processReminders, 60 * 1000);
}
