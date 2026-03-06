import { DiscordRequest } from '../commons/utils.js';

/**
 * Delete a Discord message
 * DELETE /messages/:channelId/:messageId
 */
export async function deleteMessage(req, res) {
  const { channelId, messageId } = req.params;

  if (!channelId || !messageId) {
    return res
      .status(400)
      .set('Content-Type', 'text/plain')
      .send('Bad Request: channelId and messageId are required');
  }

  try {
    const response = await DiscordRequest(
      `channels/${channelId}/messages/${messageId}`,
      {
        method: 'DELETE',
      },
    );

    if (response.status === 204) {
      const logTimestamp = new Date().toISOString();
      console.log(
        `Message deleted | channelId=${channelId} | messageId=${messageId} | date=${logTimestamp}`,
      );
      return res
        .status(200)
        .set('Content-Type', 'text/plain')
        .send('Message deleted successfully');
    }

    const errorData = await response.json();
    console.error('Error deleting message:', errorData);
    return res
      .status(response.status)
      .set('Content-Type', 'application/json')
      .json(errorData);
  } catch (error) {
    console.error('Error deleting message:', error);
    return res
      .status(500)
      .set('Content-Type', 'text/plain')
      .send('Internal Server Error');
  }
}
