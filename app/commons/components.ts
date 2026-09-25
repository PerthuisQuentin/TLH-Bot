import { ButtonStyle, ComponentType, SeparatorSpacingSize } from 'discord-api-types/v10';
import type {
    APIActionRowComponent,
    APIButtonComponentWithCustomId,
    APIComponentInMessageActionRow,
    APIComponentInContainer,
    APIContainerComponent,
    APISectionAccessoryComponent,
    APISectionComponent,
    APISeparatorComponent,
    APITextDisplayComponent,
    APIThumbnailComponent,
} from 'discord-api-types/v10';

// Building blocks for Components V2 replies. Layout stays in each command: only the
// literal shapes live here.

export function container(
    accentColor: number,
    ...components: APIComponentInContainer[]
): APIContainerComponent {
    return { type: ComponentType.Container, accent_color: accentColor, components };
}

export function text(content: string): APITextDisplayComponent {
    return { type: ComponentType.TextDisplay, content };
}

/** One to three texts, with a button or a thumbnail beside them. */
export function section(
    accessory: APISectionAccessoryComponent,
    ...components: APITextDisplayComponent[]
): APISectionComponent {
    return { type: ComponentType.Section, components, accessory };
}

export function thumbnail(url: string): APIThumbnailComponent {
    return { type: ComponentType.Thumbnail, media: { url } };
}

export function separator(): APISeparatorComponent {
    return { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };
}

export function button(
    label: string,
    customId: string,
    {
        style = ButtonStyle.Secondary,
        disabled = false,
    }: { style?: APIButtonComponentWithCustomId['style']; disabled?: boolean } = {},
): APIButtonComponentWithCustomId {
    return { type: ComponentType.Button, style, label, custom_id: customId, disabled };
}

/** Up to 5 buttons, or a single select. */
export function actionRow(
    ...components: APIComponentInMessageActionRow[]
): APIActionRowComponent<APIComponentInMessageActionRow> {
    return { type: ComponentType.ActionRow, components };
}

/**
 * The small line closing a panel. Private, it carries the Share button, which reposts the
 * panel publicly; shared, it names who posted it instead, and a shared panel has no button.
 */
export function shareFooter(
    line: string,
    { sharedBy, shareId }: { sharedBy?: string; shareId: string },
): APISectionComponent | APITextDisplayComponent {
    if (sharedBy) return text(`-# ${line} · partagé par <@${sharedBy}>`);
    return section(button('📢 Partager', shareId), text(`-# ${line}`));
}
