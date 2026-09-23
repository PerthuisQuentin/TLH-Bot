---
name: add-upgrade
description: Recipe for adding a new shop upgrade to the TLH Bot shells idle game. Use when asked to create a new upgrade, shop item or income booster.
---

# Add an upgrade

Background, and the source of truth for the steps: [docs/shells.md, Upgrades](../../../docs/shells.md#upgrades), including the modifier DSL and the current upgrade table.

## Steps

1. **Class**: subclass `BaseUpgrade` in `app/idle/core/upgrades/<kebab-name>.ts`. Declare `static readonly id / kind / costResourceId / gainResourceId / displayName / emoji / description / resetOnPrestige / shopPage` (the `/shop` page it is sold on, a `ShopPage`, not necessarily its currency's) and implement `computeCost`, `computeGain`, `computeFormatGain`. Express curves with the modifier DSL in `app/idle/core/maths.ts`. `displayName` and `description` are French. If it must stay hidden until something happens, add `static readonly unlockCondition` (pure function of an `UnlockContext`) and a French `unlockHint`; the shop, `buyUpgrade` and the profile all follow it, never gate it in `/shop`.
2. **Ids**: add the `UpgradeId` member in `app/idle/core/types.ts`, plus a `ResourceId` member if the upgrade costs or boosts a resource that does not exist yet.
3. **Register** it in `app/idle/core/upgrades/upgrade-registry.ts`. `/shop`, `/shells`, `GameInstance` and the analysis script pick it up from there.
4. **Stay pure**: `core/` imports nothing outside itself. All shell arithmetic goes through `app/idle/core/big-number.ts`, never a native `number`.
5. **Tests**: `<kebab-name>.test.ts` beside it, modelled on `harvest-bags.test.ts`: cost and gain at a few levels, including a bracket boundary.
6. **Check the curve** before calling it done:
    ```bash
    tsx scripts/analyze-upgrade.ts <upgradeId> 1 40
    tsx scripts/simulate-idle.ts --days=90
    ```
    Report payback times and where the upgrade becomes worth buying compared with the existing ones. Flags: [docs/scripts.md](../../../docs/scripts.md).
7. **Keep the bot honest**: add the upgrade to the `SYSTÈME DE COQUILLAGES` block in `app/commons/prompts.ts`, or the bot describes its own shop wrongly.
8. **Docs**: the current upgrades table in `docs/shells.md`.

## Done when

- The four checks pass, and `npm run check:core` passes.
- The analysis output is shown to the user.
