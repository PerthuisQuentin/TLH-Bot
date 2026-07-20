/**
 * What kind of activity earned shells. A game concept, not a protocol one: the rules
 * give each kind its own gain fraction, heat increment and jackpot eligibility.
 * Lives here so `core/` stays free of any dependency on the Discord adapter.
 */
export enum ChannelActivityType {
    Message = 'message',
    Reaction = 'reaction',
}

/** Value equals the JSON field name used in `GameInstanceJson.resources`. */
export enum ResourceId {
    SHELLS = 'shells',
}

export enum UpgradeId {
    DIVING_OTTERS = 'divingOtters',
    HYDRODYNAMIC_FLIPPERS = 'hydrodynamicFlippers',
    HARVEST_BAGS = 'harvestBags',
}

export enum UpgradeKind {
    ADDITIVE = 'additive',
    MULTIPLICATIVE = 'multiplicative',
}
