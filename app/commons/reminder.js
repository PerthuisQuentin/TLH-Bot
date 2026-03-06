import { readdir } from 'fs/promises';
import {
  readJsonFile,
  writeJsonFile,
  AllowedFiles,
  getFilesDirectory,
} from './files.js';

/**
 * Gets all guild IDs that have reminder files
 * @returns {Promise<string[]>} Array of guild IDs
 */
export async function getAllGuildIdsWithReminders() {
  const filesDir = getFilesDirectory();
  const files = await readdir(filesDir);
  const reminderFiles = files.filter((f) => f.endsWith('-reminder.json'));
  return reminderFiles.map((f) => f.replace('-reminder.json', ''));
}

/**
 * Gets all expired reminders for a guild
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<Array>} Array of expired reminder objects
 */
export async function getExpiredReminders(guildId) {
  const reminders = await readJsonFile(guildId, AllowedFiles.REMINDER, []);
  const now = new Date();
  return reminders.filter((r) => new Date(r.date) <= now);
}

/**
 * Adds a new reminder
 * @param {string} guildId - The Discord guild ID
 * @param {string} userId - The Discord user ID
 * @param {string} channelId - The Discord channel ID
 * @param {string} question - The reminder question/content
 * @param {Date|string} date - The reminder date (Date object or ISO string)
 * @returns {Promise<Object>} The created reminder object
 */
export async function addReminder(guildId, userId, channelId, question, date) {
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

  // Convert date to ISO string if it's a Date object
  const isoDate = date instanceof Date ? date.toISOString() : date;

  // Validate ISO date format
  if (!isoDate || isNaN(Date.parse(isoDate))) {
    throw new Error('Invalid date format. Expected ISO string or Date object');
  }

  const reminders = await readJsonFile(guildId, AllowedFiles.REMINDER, []);

  // Check user reminder limit (max 100 per user)
  const userReminders = reminders.filter((r) => r.userId === userId);
  if (userReminders.length >= 100) {
    throw new Error('Limite de rappels atteinte (100 maximum par utilisateur)');
  }

  const reminder = {
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

/**
 * Deletes a reminder by its ID
 * @param {string} guildId - The Discord guild ID
 * @param {string} reminderId - The reminder ID
 * @returns {Promise<Object|null>} The deleted reminder object, or null if not found
 */
export async function deleteReminder(guildId, reminderId) {
  if (!guildId || typeof guildId !== 'string') {
    throw new Error('guildId is required');
  }

  if (!reminderId || typeof reminderId !== 'string') {
    throw new Error('reminderId is required');
  }

  const reminders = await readJsonFile(guildId, AllowedFiles.REMINDER, []);
  const reminderIndex = reminders.findIndex((r) => r.id === reminderId);

  if (reminderIndex === -1) {
    return null;
  }

  const deletedReminder = reminders.splice(reminderIndex, 1)[0];
  await writeJsonFile(guildId, AllowedFiles.REMINDER, reminders);

  return deletedReminder;
}
