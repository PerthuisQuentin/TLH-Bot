/**
 * What the ocean scene draws, each an integer level. The generator knows nothing else: no
 * player, no game rule, so the same levels always give the same picture.
 */
export type OceanLevels = {
    /** Diving otters. The one floating at the surface is always there. */
    otters: number;
    /** Length of the bubble trail behind each diver. */
    bubbles: number;
    /** 0 nothing, 1 the seedling alone, then the reef sprouts and grows. */
    coral: number;
    kelp: number;
    /** The mound on the sand. */
    shells: number;
    bags: number;
    /** 0 absent, then one shell held per level. */
    octopus: number;
    nautilus: number;
};

/** Inclusive bounds. The key order is the order of `oceanKey`, so it never changes. */
export const OCEAN_LEVEL_RANGES: Readonly<Record<keyof OceanLevels, readonly [number, number]>> = {
    otters: [0, 10],
    bubbles: [0, 10],
    coral: [0, 10],
    kelp: [0, 10],
    shells: [0, 10],
    bags: [0, 3],
    octopus: [0, 3],
    nautilus: [0, 1],
};

export enum CoralKind {
    STAGHORN = 'staghorn',
    FAN = 'fan',
    BRAIN = 'brain',
    TUBES = 'tubes',
}
