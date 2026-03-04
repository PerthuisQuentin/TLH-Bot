import { InteractionResponseType } from 'discord-interactions';
import {
  getPaginatedXpLeaderboard,
  getUserLeaderboardEntry,
  getUserXp,
} from '../commons/xp.js';

/**
 * Builds leaderboard embed description
 * @param {Object} params - Formatting params
 * @returns {string} Embed description text
 */
function formatLeaderboardDescription({
  pageUsers,
  startIndex,
  pageSize,
  requesterId,
  requesterEntry,
  requesterXp,
}) {
  const leaderboardText = pageUsers
    .map((user, index) => {
      const rank = startIndex + index + 1;
      const line = `#${rank} <@${user.userId}> - ${user.xp} XP`;

      if (requesterId && user.userId === requesterId) {
        return `**${line}**`;
      }

      return line;
    })
    .join('\n');

  if (!requesterId) {
    return leaderboardText;
  }

  const requesterIsOnPage =
    requesterEntry &&
    requesterEntry.rank > startIndex &&
    requesterEntry.rank <= startIndex + pageSize;

  if (requesterIsOnPage) {
    return leaderboardText;
  }

  if (requesterEntry) {
    return `${leaderboardText}\n—\n**#${requesterEntry.rank} <@${requesterId}> - ${requesterEntry.xp} XP**`;
  }

  return `${leaderboardText}\n\n—\n**Non classé • <@${requesterId}> - ${requesterXp} XP**`;
}

/**
 * Handles the leaderboard command
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleLeaderboardCommand(req, res) {
  try {
    const { guild_id, data } = req.body;
    const requesterId = req.body.member?.user?.id || req.body.user?.id;

    if (!guild_id) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Cette commande ne fonctionne que sur un serveur.',
        },
      });
    }

    const pageOption = data?.options?.find((opt) => opt.name === 'page')?.value;
    const requestedPage =
      Number.isInteger(pageOption) && pageOption > 0 ? pageOption : 1;

    const paginated = getPaginatedXpLeaderboard(guild_id, requestedPage, 10);

    if (paginated.totalUsers === 0) {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "Aucun utilisateur avec de l'XP pour le moment.",
        },
      });
    }

    const pageUsers = paginated.users;
    const startIndex = paginated.startIndex;
    const currentPage = paginated.currentPage;
    const totalPages = paginated.totalPages;
    const requesterEntry = requesterId
      ? getUserLeaderboardEntry(guild_id, requesterId)
      : null;
    const requesterXp = requesterId ? getUserXp(requesterId, guild_id) : 0;
    const description = formatLeaderboardDescription({
      pageUsers,
      startIndex,
      pageSize: paginated.pageSize,
      requesterId,
      requesterEntry,
      requesterXp,
    });

    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [
          {
            title: '🏆 Classement XP',
            description,
            color: 0xffd700, // Gold color
            timestamp: new Date().toISOString(),
            footer: {
              text: `Page ${currentPage}/${totalPages} • ${paginated.totalUsers} utilisateurs`,
            },
          },
        ],
        allowed_mentions: {
          parse: [],
        },
      },
    });
  } catch (error) {
    console.error('Error handling leaderboard command:', error);
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Une erreur est survenue en récupérant le classement.',
      },
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
    options: [
      {
        type: 4,
        name: 'page',
        description: 'Numéro de page (10 utilisateurs par page)',
        required: false,
        min_value: 1,
      },
    ],
  },
  handler: handleLeaderboardCommand,
};
