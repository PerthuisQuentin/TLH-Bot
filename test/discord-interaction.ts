import { ComponentType } from 'discord-api-types/v10';
import type { Response } from 'express';

// Test-only: fakes the Express side of an interaction and reads back a Components V2 reply.

type ComponentNode = {
    type: ComponentType;
    accent_color?: number | null;
    content?: string;
    label?: string;
    custom_id?: string;
    disabled?: boolean;
    options?: Array<{ value: string; default?: boolean }>;
    components?: ComponentNode[];
    accessory?: ComponentNode;
};

export type InteractionPayload = {
    type: number;
    data: {
        content?: string;
        flags?: number;
        components?: ComponentNode[];
        allowed_mentions?: unknown;
    };
};

/** A fake Express response that records the one reply sent, and the status of a rejection. */
export function mockRes(): { res: Response; payload?: InteractionPayload; status?: number } {
    const result: { res: Response; payload?: InteractionPayload; status?: number } = {
        res: undefined as unknown as Response,
    };
    const res = {
        send: (payload: InteractionPayload) => {
            result.payload = payload;
            return res;
        },
        status: (code: number) => {
            result.status = code;
            return res;
        },
        json: () => res,
    };
    result.res = res as unknown as Response;
    return result;
}

function walk(nodes: ComponentNode[] = []): ComponentNode[] {
    return nodes.flatMap((node) => [
        node,
        ...walk(node.components),
        ...walk(node.accessory ? [node.accessory] : []),
    ]);
}

/** A Components V2 reply flattened to what a player reads and what they can click. */
export function readPanel(payload: InteractionPayload | undefined) {
    const nodes = walk(payload?.data.components);
    const select = nodes.find((n) => n.type === ComponentType.StringSelect);
    return {
        type: payload?.type,
        flags: payload?.data.flags ?? 0,
        allowedMentions: payload?.data.allowed_mentions,
        accentColor: nodes.find((n) => n.type === ComponentType.Container)?.accent_color,
        text: nodes
            .filter((n) => n.type === ComponentType.TextDisplay)
            .map((n) => n.content)
            .join('\n'),
        buttons: nodes
            .filter((n) => n.type === ComponentType.Button)
            .map((n) => ({ label: n.label, id: n.custom_id, disabled: n.disabled })),
        selected: select?.options?.find((o) => o.default)?.value,
    };
}
