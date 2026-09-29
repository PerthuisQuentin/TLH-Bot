# Ocean scene on the shells profile (working doc)

## Context

Players get a picture of their progression: an underwater cross-section in pixel art, drawn from their game state at the moment `/shells` is opened. Sea otters at the surface and diving, bubbles, kelp, a shell mound on the sand, the coral reef, the Pieuvre intendante, the nautilus.

Decisions made in discussion:

- **Pixel art, underwater cross-section.** 160×90 pixels upscaled ×5 to 800×450 nearest-neighbour, drawn in code, no asset file. Earlier tries were rejected, see Rejected.
- **The generator knows only levels, never the game.** Each dimension is an integer level (0 to 10, a few 0 to 3). Same levels, same pixels: no `userId`, no clock, no `Math.random`.
- **Levels only add.** Every element draws from its own fixed seed (`otter:3`, `kelp:5`, a coral branch seeds from its path in the tree), in a fixed slot filled in a fixed order. Going from 4 to 5 otters adds the fifth without moving the other four, and a coral grows its existing branches.
- **Mapping from the game to levels is a separate function**, the only place a rebalance touches.
- **Shown in `/shells`, between the avatar banner and `Ressources`**, on every open and every click (refresh, another player's profile, the automation switch).
- **Shared panels carry the image.**
- **The shell mound follows the current balance**, not `maxShells`: the picture shows what the player owns right now, so it shrinks when they buy and nearly empties at a prestige. This is on purpose and differs from the roles, which key off `maxShells`.
- **The reef follows the total coral ever earned**, a new stat kept up to date on every coral credit. Unlike the balance, it never drops when coral is spent on the reef upgrades, so the reef only grows.
- **No fish for now.** The dimension is left out of the generator rather than kept at 0.
- **A brand-new player sees the surface otter alone**, in an otherwise empty ocean.

The reviewed prototype is ported as `app/ocean/` (B1): an 800×450 PNG in ~25 ms, ~10 KB, identical bytes for identical levels whatever the key order.

## Current state (baseline)

- `/shells` (`app/commands/shells.ts`) answers with one V2 container: a section with the avatar thumbnail and the banner, `Ressources`, `Upgrades`, the share footer, then the controls. Clicks answer with `updateComponents`; share posts a new public panel with `replyComponents`.
- `app/commons/utils.ts`: `replyComponents` and `updateComponents` send JSON only. Nothing in the repo sends a file to Discord.
- `app/commons/components.ts` has no media gallery helper.
- No PNG or image code, no image dependency. `node:zlib` has `deflateSync` and `crc32` (Node 24).
- `getShellsProfile` (`app/idle/shells-profile.ts`) reads the instance; the scene needs the raw instance fields rather than the formatted profile.
- Stats hold `maxShells`, `runMaxShells` and `prestigeCount`. Nothing records how much coral a player has earned: the balance drops as it is spent.
- Coral is credited in one place, `addResource(CORAL, …)` from `GameInstance.prestige()`. Every coral-priced upgrade (`nourishingReef`, `buildingPolyps`, `millennialShell`, `stewardOctopus`) has `resetOnPrestige = false`, so the coral a player ever earned is exactly their balance plus the cost of every coral-priced level they own.

## Touch points

- New: `app/ocean/` (generator), `app/idle/ocean-levels.ts` (mapping), `scripts/render-ocean.ts` (contact sheets).
- `app/commons/utils.ts`, `app/commons/components.ts`, `app/commands/shells.ts`.
- `app/idle/core/game-instance.ts` (the new stat), `scripts/add-total-coral.ts` (one-shot migration).
- `app/commons/prompts.ts` (one line in `SYSTÈME DE COQUILLAGES`).
- Docs: `docs/architecture.md` (attachments, folder roles), `docs/commands.md` (`/shells`), `docs/shells.md` (the mapping), `docs/storage.md` (the new stat), `docs/scripts.md` (the new script), `CLAUDE.md` (folder list if `app/ocean/` is added).

## Goals

- A player sees their ocean in `/shells`, updated on every click.
- A new mechanic or rebalance changes the mapping, never the generator.
- Rendering stays well inside the 3-second interaction deadline, with no new npm dependency.

## Design

### Scene levels

| Level      | Range | Drawn as                                                        |
| ---------- | ----- | --------------------------------------------------------------- |
| `otters`   | 0-10  | Diving otters, fixed slots. The surface otter is always there.  |
| `bubbles`  | 0-10  | Length of the bubble trail rising from each diver.              |
| `coral`    | 0-10  | 0 nothing, 1 the seedling alone, 2-10 reef pieces sprout, grow. |
| `kelp`     | 0-10  | Number of stalks, and their height.                             |
| `shells`   | 0-10  | The mound on the sand, nested domes.                            |
| `bags`     | 0-3   | Harvest bags beside the mound.                                  |
| `octopus`  | 0-3   | 0 absent, else on its rock holding one shell per level.         |
| `nautilus` | 0-1   | Swimming mid-water.                                             |

`oceanKey(levels)` joins them in this fixed order (`4-2-7-5-6-1-2-1`): the cache key.

### Mapping from the game (proposal, calibrated in B2)

| Level      | Source                            | Proposal                                |
| ---------- | --------------------------------- | --------------------------------------- |
| `otters`   | `divingOtters` level              | tiers, top tier at a late-game level    |
| `bubbles`  | `hydrodynamicFlippers` level      | tiers                                   |
| `shells`   | current shells balance            | `floor(log10(balance) / 3)`, 10 at 1e30 |
| `kelp`     | growth ring days                  | a year, see `docs/shells.md`            |
| `bags`     | `harvestBags` level               | tiers up to 3                           |
| `coral`    | seedling, then `stats.totalCoral` | 1 with the seedling, then log tiers     |
| `octopus`  | `stewardOctopus` level            | as is                                   |
| `nautilus` | `millennialShell` owned           | as is                                   |

Nothing coral-related shows before the seedling, which keeps the coral layer hidden from a locked player, as the profile text already does.

### Sending the image

Discord documents file uploads only on its REST endpoints, not on the immediate HTTP answer to the webhook. So the panel defers, then edits: `replyDeferred` (ephemeral on the deferral, for `/shells` and for share) or `replyDeferredUpdate` (a click, no thinking state), then `editInteractionComponents` with the PNG as `files`, in `multipart/form-data`, referenced from a `MediaGallery` as `attachment://ocean.png`. The edit's `attachments` lists only the new file, which replaces the previous one. Cost: a brief "thinking" on open and share, nothing on a click.

A small in-memory LRU keyed by `oceanKey` avoids re-rendering the same scene; the render is cheap enough that the cache is a nicety, not a requirement.

## Implementation plan

### Part A: prerequisites (no player-facing change)

**A1. Files on component replies**

- Check the Discord docs for files on `CHANNEL_MESSAGE_WITH_SOURCE` and `UPDATE_MESSAGE` interaction callbacks with Components V2: field names, the `attachments` array, how an update replaces a previous attachment.
- `replyComponents` and `updateComponents` take an optional `files: { name, data }[]`. Without files they send exactly the JSON they send today; with files, a multipart body.
- `mediaGallery(...urls)` in `app/commons/components.ts`.
- Tests: the JSON path is unchanged; the multipart body carries `payload_json` and the file parts with the right names.
- Docs: `docs/architecture.md`, Buttons and other components (how a reply carries a file).
- No re-register, no migration.
- **Status**: done.
- **As built**: deviation from the plan, decided with the user. The Discord docs only document files on the REST endpoints (the interaction callback and the webhook edit), not on the HTTP answer to the webhook that `replyComponents` and `updateComponents` send. So those two stay JSON-only, and a panel with an image defers then edits. `DiscordRequest` takes `files` and turns multipart (`payload_json`, `files[n]`, fetch writing the boundary). `editInteractionComponents(token, components, { files, allowedMentions })` edits `@original` as V2 and, with files, lists exactly them in `attachments`; `updateInteractionResponse` now delegates to it with an unchanged payload. `replyDeferred` takes `ephemeral`, `replyDeferredUpdate` acknowledges a click (type 6). `mediaGallery(...items)` in `components.ts`, alt text optional. Nothing calls the new helpers yet.

**A2. Total coral earned, `stats.totalCoral`**

- `StatsJson` gains `totalCoral: string`, required: a BigNum as a JSON string like the other stats. `addResource` raises it on every coral credit; nothing lowers it, a prestige included.
- One-shot `scripts/add-total-coral.ts`, modelled on the `add-auto-buy-flag.ts` that ran for the automation: backfills `coral balance + Σ cost of the owned levels of every coral-priced upgrade`. Dry run by default, `--apply`, strict schema validation, atomic write, idempotent (an entry that has the field keeps it).
- The backfill prices levels one by one where the game charged `bnCeil` per purchase; today's coral costs are whole numbers, so both agree. The script reports the players where they would not.
- Tests: a prestige raises `totalCoral` by the payout, a coral purchase leaves it, `toJson`/constructor round-trip; the backfill formula on a player with bought reef levels.
- Docs: `docs/storage.md` (game-instances format), `docs/shells.md` (stats), `docs/scripts.md` (the script, one-shot).
- **Migration**: stop the bot, back up `prod-files/`, run `tsx scripts/add-total-coral.ts --dir=prod-files --apply`, then start the new code. Same for `files/` before an `npm run dev` on this branch.
- **Status**: done.
- **As built**: `totalCoral` is required in `StatsJsonSchema` and `StatsData`, raised in `addResource` on every coral credit, written by `toJson`, `'0'` in `newInstance`. Every test fixture and the two simulations' starting instances gained `totalCoral: '0'`. Deviation: no unit test for the backfill formula, which lives in the script alone; it was checked on a copy of `prod-files/` instead. 28 players, 4 backfilled above 0 (13, 20, 50 and 10, each with one prestige), no warning, and the 50 matches the hand count (14 coral + reef 1+4+16 + polyps 1+2+4+8). A second `--apply` backfills 0, and the migrated file loads through `GameInstanceJsonSchema` with every `totalCoral` kept. The script also aborts if a coral-priced upgrade ever resets on prestige, and warns on a fractional level cost or a prestige count that disagrees with the coral.
- **Found outside the step**: `files/` (dev) fails validation before this script even adds anything: its 33 players have no `autoBuyEnabled`, so `add-auto-buy-flag.ts` never ran there. Run it first, then this one.

### Part B: the feature

**B1. The generator, `app/ocean/`**

- Port the prototype to TypeScript: `types.ts` (`OceanLevels`, ranges), `png.ts` (encoder, `node:zlib` only), `canvas.ts`, `sprites.ts`, `render.ts` (`renderOcean(levels): Buffer`, `oceanKey`, `normalizeLevels`).
- Imports nothing from the rest of the app: it is a leaf, like `core/`.
- `scripts/render-ocean.ts`: writes the contact sheets (one dimension swept, and all together) to a folder, for reviewing a sprite or a slot change.
- Tests: clamping, key stability across key order, a few param sets pinned by hash, the PNG header and size.
- Docs: `docs/scripts.md`, `docs/architecture.md` folder roles, `CLAUDE.md` if the folder list names it.
- **Status**: done.
- **As built**: `types.ts` (`OceanLevels`, `OCEAN_LEVEL_RANGES`, `CoralKind`), `png.ts`, `canvas.ts` (`PixelCanvas`, `seededRandom`), `sprites.ts`, `layers.ts` (slots and one draw function per layer), `render.ts` (`normalizeLevels`, `oceanKey`, `drawOcean`, `renderOcean`). The port renders byte-identical PNGs to the prototype for five level sets, fish at 0, and the tests pin four of those hashes. Fish are gone from the generator, as decided; `oceanKey` has 8 levels. A lint block, like the `core/` one, keeps `app/ocean/` from importing the rest of the app. `scripts/render-ocean.ts` writes one sheet per level plus `sheet-all.png`, or a single scene with `--levels=<key>`.

**B2. The mapping, `app/idle/ocean-levels.ts`**

- `oceanLevelsFor(instance: ReadonlyGameInstance): OceanLevels`, pure.
- Calibrate the tiers on the simulator (`scripts/simulate-prestige.ts`) and on the real data: where a typical player sits after a week, a month, at each prestige. Record the resulting table here with its reason.
- Tests: each source moves its level and only its level; a new player gives the empty scene (surface otter alone); the coral stays at 0 while the seedling is not owned.
- Docs: `docs/shells.md`, a short "Ocean scene" section with the mapping table.
- **Status**: done.
- **As built**: `oceanLevelsFor(instance: ReadonlyGameInstance): OceanLevels`, a threshold count per source. The thresholds and the calibration table are in `docs/shells.md`, Ocean scene, rather than duplicated here. The upgrades read their current level, consistent with the balance choice: everything of the run resets at a prestige, and only the kelp (rings) and the reef (`totalCoral`) grow across runs. The kelp was first calibrated to fill at 100 days, the rings' cap; the user moved it to a year, so it keeps growing past the cap (several production players already had 126 days). Checked on a migrated copy of `prod-files/`: 28 players, 18 distinct scenes.

**B3. Wire it into `/shells`**

- Every `/shells` answer defers (`replyDeferred({ ephemeral })` on open, `replyDeferred()` on share, `replyDeferredUpdate` on a click) and then edits with `editInteractionComponents`. The error path past the deferral goes through `updateInteractionResponseOrLog`, as `/ask` does, and the refusals that need no image (automation switch on someone else's profile, nothing to automate) stay immediate replies before the deferral.
- `shellsPanel` puts a `mediaGallery('attachment://ocean.png')` between the banner section and `Ressources` and returns the PNG with the components; every reply and update in `shells.ts` sends it.
- LRU cache keyed by `oceanKey`.
- Tests: the panel carries the gallery and the file, on open, click and share.
- Docs: `docs/commands.md` (`/shells`), one line in `SYSTÈME DE COQUILLAGES` (`app/commons/prompts.ts`) so the bot can explain the picture.
- No re-register (the definition is unchanged), no migration.
- **Status**: done, pending a check in Discord.
- **As built**: `shellsPanel` returns `{ components, files }`; the gallery sits right under the banner section, before the separator and `Ressources`, with a French alt text. `/shells` defers ephemeral, share defers public, every other click `replyDeferredUpdate`, then `sendPanel` edits with the PNG and `NO_MENTIONS`. The refusals (no user, someone else's switch, nothing to automate) and the automation write stay before the deferral, as immediate replies; past it the error path is `updateInteractionResponseOrLog`. The cache is `app/ocean/cache.ts`: `createOceanCache(size, render)`, and `renderOceanCached` at 256 entries. The PNG is typed `Buffer<ArrayBuffer>` end to end, which `Blob` requires. `test/discord-interaction.ts` gained `captureEdits()` (stubs `fetch`, records each edit, multipart or JSON) and `readPanel` reads the gallery and the container layout; the `/shells` tests now read the panel from the edit and the deferral type from the HTTP answer.
- **Known leftover**: moving from `/shells` to `/shop` or `/prestige` through the navigation row answers with `UPDATE_MESSAGE` and no `attachments` field, so `ocean.png` stays attached to the message. On a V2 message a file no component names is not displayed, so nothing shows; it only lingers until the next `/shells` redraw replaces it.
- **Not verifiable in tests**: Discord's real handling (the image in an ephemeral reply, its replacement on a click, the shared copy). To check with `npm run dev`, after migrating `files/`.

## Open questions

None left from the discussion. The tier thresholds are settled in B2 on the simulator.

## Later

- Sprite polish: otter variants (on its back with a shell, diving head down), kelp capped below the surface, a rounder mound.
- An animated GIF (swimming otters, rising bubbles).
- A server-wide ocean on `/leaderboard`, one otter per active player.
- Heat as the light of the scene.
- Fish, the sprite and slots are in the prototype; a source is to be chosen (income per message was the proposal).

## Rejected

- **Emoji grid**: cheap-looking, width breaks on mobile.
- **Vector SVG through `@resvg/resvg-js`**: a native dependency, and code-drawn vector art looked off (otters like logs, inconsistent styles).
- **Top-down river and lagoon in pixel art**: fine, but the ocean puts otters, shells and coral in one coherent place.
- **Seeding by `userId`** so every player gets a unique layout: the requirement is same levels, same image.
- **Serving the PNG from an Express route and linking its URL**: needs a public base URL variable and an unauthenticated render endpoint; an attachment needs neither.
- **The mound on `maxShells`**: the user chose the current balance, so the picture reflects the moment.
- **The reef on the coral balance**: coral is spent on the reef upgrades, so buying one would shrink the reef.
- **The reef on the reef upgrade levels and `prestigeCount`**: an indirect measure, when the total coral earned says it directly.
