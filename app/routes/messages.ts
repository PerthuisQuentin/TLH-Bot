import type { Request, Response } from 'express';
import { DiscordRequest } from '../commons/utils.js';

export async function deleteMessage(
    req: Request,
    res: Response,
): Promise<void> {
    const { channelId, messageId } = req.params;

    if (!channelId || !messageId) {
        res
            .status(400)
            .set('Content-Type', 'text/plain')
            .send('Bad Request: channelId and messageId are required');
        return;
    }

    try {
        const response = await DiscordRequest(
            `channels/${channelId}/messages/${messageId}`,
            { method: 'DELETE' },
        );

        if (response.status === 204) {
            const logTimestamp = new Date().toISOString();
            console.log(
                `Message deleted | channelId=${channelId} | messageId=${messageId} | date=${logTimestamp}`,
            );
            res
                .status(200)
                .set('Content-Type', 'text/plain')
                .send('Message deleted successfully');
            return;
        }

        const errorData = await response.json();
        console.error('Error deleting message:', errorData);
        res
            .status(response.status)
            .set('Content-Type', 'application/json')
            .json(errorData);
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).set('Content-Type', 'text/plain').send('Internal Server Error');
    }
}
