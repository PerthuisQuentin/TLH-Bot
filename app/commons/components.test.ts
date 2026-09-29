import { describe, expect, it } from 'vitest';
import { ComponentType } from 'discord-api-types/v10';
import { mediaGallery } from './components.ts';

describe('mediaGallery', () => {
    it('wraps each url as a media item, with its alt text when given', () => {
        expect(
            mediaGallery(
                { url: 'attachment://ocean.png', description: 'Votre océan' },
                { url: 'https://example.com/a.png' },
            ),
        ).toEqual({
            type: ComponentType.MediaGallery,
            items: [
                { media: { url: 'attachment://ocean.png' }, description: 'Votre océan' },
                { media: { url: 'https://example.com/a.png' } },
            ],
        });
    });
});
