import { InteractionResponseType } from 'discord-interactions';
import { createMessageBody } from '../commons/utils.js';
import { getXpLeaderboard } from '../commons/xp.js';

/**
 * Handles the leaderboard command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleLeaderboardCommand(req, res) {
  try {
    const { guild_id } = req.body;

    if (!guild_id) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: createMessageBody(
          'Cette commande ne fonctionne que sur un serveur.',
        ),
      });
    }

    const leaderboard = getXpLeaderboard(guild_id);

    if (leaderboard.length === 0) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: createMessageBody(
          "Aucun utilisateur avec de l'XP pour le moment.",
        ),
      });
    }

    // Format leaderboard (top 10)
    const topUsers = leaderboard.slice(0, 10);
    const leaderboardText = topUsers
      .map((user, index) => `${index + 1}. <@${user.userId}> - ${user.xp} XP`)
      .join('\n');

    const message = `**🏆 Classement XP 🏆**\n\n${leaderboardText}`;

    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: createMessageBody(message),
    });
  } catch (error) {
    console.error('Error handling leaderboard command:', error);
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: createMessageBody(
        'Une erreur est survenue en récupérant le classement.',
      ),
    });
  }
}

export const leaderboardCommand = {
  definition: {
    name: 'leaderboard',
    description: 'Affiche le classement XP du serveur',
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  handler: handleLeaderboardCommand,
};
