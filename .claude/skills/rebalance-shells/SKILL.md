---
name: rebalance-shells
description: Recipe for rebalancing the TLH Bot shells economy (rates, multipliers, heat, streak, passive income, jackpot, upgrade curves). Use when asked to tweak, buff, nerf or rebalance any number of the idle game.
---

# Rebalance the shells game

Read [docs/shells.md](../../../docs/shells.md) first: the earn pipeline, every multiplier, and the formulas behind them.

## Invariants a rebalance must not break

- All shell arithmetic goes through `app/idle/core/big-number.ts`. Balances reach 10^30 and beyond.
- Roles are evaluated against `maxShells`, the all-time peak, never the current balance, so spending can never demote anyone.
- Game rules live in `app/idle/core/`, which imports nothing outside itself.

## Steps

1. **Measure before**: run the relevant simulation on the current rules and keep the output.
    ```bash
    tsx scripts/simulate-idle.ts --days=365 --messages-per-day=500
    tsx scripts/analyze-upgrade.ts <upgradeId> 1 40
    tsx scripts/simulate-heat.ts
    ```
    Pick what the change touches. Flags and how to read the output: [docs/scripts.md](../../../docs/scripts.md). `--messages-per-day` is an effective count that already absorbs heat, streak and passive income.
2. **Change** the constants or curves in `app/idle/core/`.
3. **Measure after** with the same commands, and show the user a before/after comparison: time to each role threshold, upgrade payback, whatever the change was meant to move.
4. **Tests**: update the expectations in the affected `app/idle/core/**/*.test.ts`. A changed number in a test should match a change the user asked for, not paper over an unintended one.
5. **Keep the bot honest**: update the `SYSTÈME DE COQUILLAGES` block in `app/commons/prompts.ts`. It is the text the bot reads when explaining the rules, and nothing in the build catches it drifting.
6. **Docs**: `docs/shells.md`.

## Done when

- The four checks pass, and `npm run check:core` passes.
- The before/after numbers are in front of the user.
