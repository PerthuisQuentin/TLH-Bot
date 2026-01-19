/**
 * Replaces Discord mention IDs with usernames
 * @param {string} content - The message content
 * @param {Array} mentions - Array of mention objects from Discord
 * @returns {string} Content with mentions replaced by usernames
 */
function replaceMentions(content, mentions) {
  if (!mentions || mentions.length === 0) return content;

  return content.replace(/<@(\d+)>/g, (match, id) => {
    const mention = mentions.find((m) => m.id === id);
    return mention ? `@${mention.username}` : match;
  });
}

/**
 * Extracts content from a Discord message object
 * @param {Object} msg - Discord message object
 * @returns {string} The message content or empty string
 */
function extractContent(msg) {
  // Normal messages have content directly
  if (msg.type === 0 && msg.content) {
    return msg.content;
  }
  // Interaction responses have content in components
  if (msg.type === 20 && msg.components?.[0]?.content) {
    return msg.components[0].content;
  }
  return '';
}

/**
 * Formats a single Discord message for context
 * @param {Object} msg - Discord message object
 * @returns {string|null} Formatted message string or null if no content
 */
function formatMessage(msg) {
  let content = extractContent(msg);

  if (!content) return null;

  // Replace mentions with usernames
  content = replaceMentions(content, msg.mentions);

  // Identify if message is from a bot
  let displayName;
  if (msg.author.bot) {
    displayName = '🤖 ' + (msg.author.global_name || msg.author.username);
  } else {
    displayName = msg.author.global_name || msg.author.username;
  }
  const username = msg.author.username;

  // Format timestamp
  const timestamp = new Date(msg.timestamp);
  const dateStr = timestamp.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  });
  const timeStr = timestamp.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `👤 ${displayName} (@${username}) • 🕐 ${dateStr} ${timeStr}\n${content}`;
}

/**
 * Formats an array of Discord messages for context
 * @param {Array} messages - Array of Discord message objects
 * @returns {string} Formatted conversation context
 */
function formatMessagesContext(messages) {
  return messages
    .reverse()
    .map(formatMessage)
    .filter((line) => line !== null)
    .join('\n\n---\n\n');
}

export {
  replaceMentions,
  extractContent,
  formatMessage,
  formatMessagesContext,
};
