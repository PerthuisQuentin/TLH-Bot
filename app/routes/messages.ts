import type { Request, Response } from 'express';
import { DiscordApiError, DiscordRequest } from '../commons/utils.ts';

export async function deleteMessage(req: Request, res: Response): Promise<void> {
    const channelId = req.params.channelId as string | undefined;
    const messageId = req.params.messageId as string | undefined;

    if (!channelId || !messageId) {
        res.status(400)
            .set('Content-Type', 'text/plain')
            .send('Bad Request: channelId and messageId are required');
        return;
    }

    try {
        // Throws on any non-2xx, so reaching the next line means Discord accepted it.
        await DiscordRequest(`channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });

        const logTimestamp = new Date().toISOString();
        console.log(
            `Message deleted | channelId=${channelId} | messageId=${messageId} | date=${logTimestamp}`,
        );
        res.status(200).set('Content-Type', 'text/plain').send('Message deleted successfully');
    } catch (error) {
        // Forward Discord's own status: an unknown message id is the caller's 404, and
        // answering 500 would blame this service for it.
        if (error instanceof DiscordApiError) {
            console.error(
                `Error deleting message | channelId=${channelId} | messageId=${messageId} | status=${error.status}`,
                error.body,
            );
            res.status(error.status)
                .set('Content-Type', 'text/plain')
                .send(error.body || `Discord returned ${error.status}`);
            return;
        }

        console.error('Error deleting message:', error);
        res.status(500).set('Content-Type', 'text/plain').send('Internal Server Error');
    }
}
