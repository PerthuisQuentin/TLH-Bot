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
    /** Earned by prestiging, never by activity, so nothing ever seeds an income for it. */
    CORAL = 'coral',
}

export enum UpgradeId {
    DIVING_OTTERS = 'divingOtters',
    HYDRODYNAMIC_FLIPPERS = 'hydrodynamicFlippers',
    HARVEST_BAGS = 'harvestBags',
    CORAL_SEEDLING = 'coralSeedling',
    NOURISHING_REEF = 'nourishingReef',
    BUILDING_POLYPS = 'buildingPolyps',
}

/**
 * The `/shop` aisle an upgrade is sold in. Declared on the upgrade rather than derived from
 * its currency, so an aisle can mix currencies. Values double as the `page` option's values.
 */
export enum ShopPage {
    SHELLS = 'shells',
    /** One-shot unlocks, whatever they cost: bought once, gone from the shop after. */
    TREASURES = 'treasures',
    CORAL = 'coral',
}

/** How an upgrade's gain enters `computeIncome`: summed, multiplied, or not at all. */
export enum UpgradeKind {
    ADDITIVE = 'additive',
    MULTIPLICATIVE = 'multiplicative',
    /**
     * Neither: the upgrade changes something other than an income, and `computeIncome`
     * skips it because it matches neither of the two filters. What it does instead is the
     * class's own business, read by whoever cares — the way `coralSeedling` is read by
     * `GameInstance.coralUnlocked`.
     */
    CUSTOM = 'custom',
}
