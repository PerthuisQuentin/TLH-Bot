# Storage

All state is flat files under `files/` (configurable via `FILES_DIR`), named `{guildId}-{fileType}.{txt|json}`. The guild ID is the partition key: nothing is shared between servers, and resetting a server means deleting the files carrying its prefix.

Files are accessed **only** through `app/storage/` (the `fileStore` singleton). Nothing else in the codebase touches `fs` for guild data.

---

## The store

### Why it exists

The naive version — read the JSON, mutate the object, write it back — loses updates. Two Discord events arriving within a few milliseconds both read the same balance, both add their gain to it, and the second write erases the first. Under load this is not rare: a burst of ten concurrent messages lost nine of them.

The fix is to make the in-RAM copy authoritative and to run every read-modify-write cycle **synchronously**, so it can never span an `await`.

### Structure

| Class                                  | File                     | Owns                                                                             |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `StoredFile<T>`                        | `storage/stored-file.ts` | One file's state: value, dirty flag, load dedup, write chain, flush timer.       |
| `JsonStoredFile<T>` / `TextStoredFile` | same                     | Serialization and the missing-file policy.                                       |
| `FileStore`                            | `storage/file-store.ts`  | The map of open files, the idle sweeper, the shutdown flush.                     |
| —                                      | `storage/types.ts`       | File-type registry, defaults, zod schemas.                                       |
| `fileStore`                            | `storage/index.ts`       | The singleton, plus `startFileStore()` which registers the SIGTERM/SIGINT flush. |

`startFileStore()` is called once from `app.ts`.

### API

| Call                                          | Semantics                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fileStore.updateJson(guildId, type, mutate)` | **The only correct way to change a JSON file.** `mutate` must be synchronous — that is what makes the cycle atomic. Write-behind. |
| `fileStore.readJson(guildId, type)`           | Returns the live in-RAM object. Treat it as read-only.                                                                            |
| `fileStore.writeJson(guildId, type, value)`   | Replaces the whole content and awaits the disk. For REST writes, whose caller is told it happened.                                |
| `fileStore.readText` / `writeText`            | Same, for `.txt` files.                                                                                                           |
| `fileStore.flush(guildId, type)`              | Forces a pending write now. Used by `/shop`, where the player is told the purchase succeeded.                                     |
| `fileStore.flushAll()`                        | Shutdown path.                                                                                                                    |

Writing via `readJson` then `writeJson` reintroduces the lost-update race. Don't.

### Timings

`DEFAULT_OPTIONS` in `storage/file-store.ts`:

| Option            | Value | Effect                                                                                                                                                         |
| ----------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flushDelayMs`    | 1 s   | Delay between the **first** pending change and the disk write. Not a resetting debounce, so a steady stream of updates cannot postpone the write indefinitely. |
| `staleAfterMs`    | 60 s  | A clean copy older than this is re-read, so edits made outside the process are picked up.                                                                      |
| `idleAfterMs`     | 2 min | A clean copy untouched for this long is swept out of RAM.                                                                                                      |
| `sweepIntervalMs` | 30 s  | How often the sweeper runs.                                                                                                                                    |

Neither the staleness re-read nor the eviction ever happens while the copy is dirty.

### Guarantees

- **Atomic writes.** The payload goes to a `{path}.{pid}.tmp` sibling, then `rename`. A reader never observes a partial file, and a shorter write never leaves the tail of a longer one behind.
- **Deduplicated loads.** Concurrent misses share one `loading` promise instead of each hitting the disk.
- **Serialized writes.** Flushes are chained, so two writes never overlap on the same path.
- **Failed flushes retry.** A write error re-marks the file dirty rather than dropping the change.
- **A dirty copy wins.** If an update lands while a read is in flight, the RAM copy is newer than the disk and is kept.

### What atomic writes do not cover

The `.tmp` sibling is removed in `writeAtomically`'s `catch`, which only runs when an exception is thrown. A process killed outright between the write and the `rename` — SIGKILL, OOM killer, a container hard-stop — runs no `catch`, so its temp file stays on disk. The pid in the name means a restarted process writes a different one rather than reusing it, so they accumulate.

**No data is at risk.** A `.tmp` is never addressable: `getFilePath` only ever builds `{guildId}-{fileType}.{txt|json}`, and the one other place that scans the directory matches on an exact suffix — `endsWith('-shells.json')` in `scripts/migrate-game-instances.ts` — which a name ending in `.tmp` does not satisfy. The only visible consequence is `GET /api/files`, which returns a raw `readdir` and lists them alongside real files.

This is accepted rather than fixed: a hard kill is rare and the leak is slow. If it ever needs cleaning up, filter the route, and purge **by age** rather than by mere presence — during a deployment where the old container is still running, it may be mid-write on its own temp file, and deleting it would make its `rename` fail.

---

## Adding a file type

Four coupled spots, all in `storage/types.ts`:

1. `AllowedFiles` — the identifier.
2. `JsonFileTypeMap` (or the `TEXT_FILES` set) — which extension and which TypeScript type.
3. `JSON_DEFAULTS` — what a missing file reads back as.
4. `JSON_SCHEMAS` — the zod schema guarding the REST write route.

Missing JSON files are **not** errors: reads fall back to `JSON_DEFAULTS`. Missing **text** files reject with `ENOENT` on purpose, because callers (`prompts.ts`) rely on it to apply their own fallback.

---

## File reference

```
files/
├── {guildId}-config.json           server configuration
├── {guildId}-system.txt            system prompt (AI personality)
├── {guildId}-memory.txt            AI accumulated memory
├── {guildId}-game-instances.json   shells game state
├── {guildId}-shells.json           legacy, superseded by game-instances
└── {guildId}-upgrades.json         legacy, superseded by game-instances
```

### `{guildId}-game-instances.json`

The whole shells game state, one entry per player. See [shells.md](./shells.md) for what the values mean.

```json
[
    {
        "userId": "123456789",
        "resources": { "shells": "531234" },
        "stats": { "maxShells": "912004" },
        "income": { "shells": "360" },
        "streak": { "value": 4, "lastDate": "2026-08-10" },
        "lastActiveAt": "2026-08-10T18:42:11.003Z",
        "upgrades": { "divingOtters": 45, "hydrodynamicFlippers": 3, "harvestBags": 0 }
    }
]
```

| Field              | Type   | Description                                                                                                                                                                   |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userId`           | string | Discord user ID.                                                                                                                                                              |
| `resources`        | object | Balance per `ResourceId`. Only `shells` exists today; a missing key reads as 0.                                                                                               |
| `resources.shells` | string | Current balance.                                                                                                                                                              |
| `stats`            | object | Lifetime counters that outlive spending. Only `maxShells` exists today.                                                                                                       |
| `stats.maxShells`  | string | All-time peak balance. Role thresholds are evaluated against this, never the current balance.                                                                                 |
| `income`           | object | Rate per `ResourceId`, earned per message/reaction/passive tick. Only `shells` exists today.                                                                                  |
| `income.shells`    | string | Recomputed from the upgrade levels after every purchase.                                                                                                                      |
| `streak.value`     | number | Consecutive active days.                                                                                                                                                      |
| `streak.lastDate`  | string | `YYYY-MM-DD`, Europe/Paris.                                                                                                                                                   |
| `lastActiveAt`     | string | ISO timestamp passive income has been credited up to — the last earning event, minus the fraction of a shell that event did not pay for. Passive income integrates from here. |
| `upgrades`         | object | Level per `UpgradeId`. A missing key reads as 0.                                                                                                                              |

**Shell amounts are JSON strings.** Balances reach 10^30 and beyond, so a native `number` would silently lose precision. They are parsed through `app/idle/core/big-number.ts` (a decimal.js wrapper) and rendered with `formatBigNum`.

The file is read and written through `app/idle/game-instance-storage.ts`.

`getGameInstance` and `getAllGameInstances` return a **`ReadonlyGameInstance`**: a copy detached from what is persisted, with every mutator removed from the type. Mutating one would change RAM and reach no file, so the type refuses it rather than let the loss happen silently.

`updateGameInstance(guildId, userId, mutate)` is the only mutation path, and the change has to happen **inside** `mutate`:

- `mutate` must be synchronous. It runs between the load and the write-back, which is what makes the read-modify-write atomic; an `await` in it would let a concurrent event write back a stale snapshot. Whatever it returns is returned by `updateGameInstance`.
- The instance must not escape the callback. Keeping a reference and mutating it afterwards is the detached-copy problem again, this time with no type to catch it.
- The write is deferred by about a second. A change the player is told succeeded — a shop purchase — needs `flushGameInstances(guildId)` behind it.
- A player absent from the file is created on first write, so callers never have to pre-register anyone.

### `{guildId}-config.json`

```json
{
    "noAskChannels": ["channel-id"],
    "noShellChannels": ["channel-id"],
    "noChatChannels": ["channel-id"],
    "shellsRoles": [
        { "roleId": "111...", "threshold": "500" },
        { "roleId": "222...", "threshold": "2000" }
    ],
    "chatEnabled": true,
    "chatNicknames": ["Gégé", "le bot"],
    "chatIndirectProbability": 0.1,
    "chatRandomProbability": 0.01
}
```

Thresholds are **strings**, parsed with `bnFromJSON` (which still accepts legacy numbers). See [configuration.md](./configuration.md) for the field reference.

A file that cannot be parsed is not the same as a missing one: a missing file reads back as `{}` (nothing excluded), while a malformed one makes `readGuildConfigOrNull` return `null`, which both gating callers treat as "not allowed here". A stray comma therefore silences the bot rather than unlocking every channel the file was meant to exclude.

### `{guildId}-system.txt`

Free-form text defining the AI's personality for this server, injected at the top of every prompt. Edited by hand or through the REST API.

### `{guildId}-memory.txt`

Persistent AI memory, written by the model itself. The model appends its notes after a `### [MÉMOIRE]` marker; `app/commons/response.ts` splits the response, sends the first half to the user and silently persists the second. The memory half is never surfaced.

What tells the model to emit the marker is the response-format block of the same guild's `{guildId}-system.txt`, which is not in the repo, so nothing can verify that the two sides still agree. The split is deliberately tolerant instead of exact: the accent is optional, the English `MEMORY` is accepted, case is ignored, two to four hashes work, spaces inside the brackets are allowed, and the text is normalized to NFC first so an `É` written as `E` plus a combining accent still matches. Only the hashes and the brackets are required, so a reply that merely mentions the word is not cut in half.

A miss would be silent and costly, the memory notes going to the channel rather than to this file, so the pattern is meant to be widened when a new spelling shows up, never tightened.

Entries are keyed by Discord ID rather than display name, because two members can share a nickname:

```
Alice [ID:333] aime les jeux vidéo.
```

### Legacy: `shells.json` and `upgrades.json`

Superseded by `game-instances.json`. The `ShellsUser` / `UserUpgrades` types survive in `app/commons/types.ts` because the REST API still exposes both files and the migration script reads them. Don't build new features on them.

---

## Migration

`game-instances.json` is built once per environment from the legacy pair:

```bash
tsx scripts/migrate-game-instances.ts            # dry run, writes nothing
tsx scripts/migrate-game-instances.ts --apply
```

This must run **before** the refactored bot starts. A missing `game-instances.json` reads back as `[]`, and every player would restart from zero. See [scripts.md](./scripts.md) for the flags.

---

## Backup

Copy `files/`. That is the entire persistent state. To reset one server, delete the files carrying its guild ID prefix.
