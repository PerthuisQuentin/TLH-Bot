---
name: workflow
description: How work is run on TLH Bot, from idea to pushed branch - discuss the subject, write a plan, execute it step by step, then commit with gitmoji and push. Use when starting a feature, a rework or any change bigger than a one-file fix, when asked to make a plan, to continue with the next step, or to commit, push or open a branch.
---

# Workflow

Four phases. The user moves the work from one to the next: never start the next phase, or the next step of the plan, without their go.

## 1. Discuss

Nothing is written to the code in this phase.

- Restate what the user wants in one or two sentences, then read the code and docs the subject touches before proposing anything.
- Show consequences, not just options: what changes for players, which existing data or players it affects, what it costs to build. Numbers on the actual data beat reasoning (`prod-files/` or `files/`, read-only).
- Balancing claims come from the simulators (`scripts/simulate-*.ts`), never from algebra alone.
- Offer 2-4 options with a recommendation, then let the user decide. Names, prices, player-facing wording and trade-offs that hurt some players are the user's call; ask with `AskUserQuestion` when they block the next step.

## 2. Plan

A temporary working doc, `docs/<topic>.md`, in English, that the user and Claude fill in together. It holds intent and decisions, never behaviour.

- **Current state**: what exists today, the baseline every step is measured against.
- **Touch points**: the files and docs involved.
- **Goals**, **Design steps** (what), **Open questions**, **Later**, **Rejected** (with the reason, so they don't come back).
- **Implementation plan** (in which order it gets built):
    - **Part A, prerequisites**: refactors and renames that change no balance and no player-facing number, each shippable on its own.
    - **Part B, the change itself**.
    - Per step: what changes, tests, docs to update, and whether it needs a command re-register or a data migration.

Record every decision in the doc as it is made, with its reason.

## 3. Execute, one step at a time

- Branch first if on `main` (see Ship).
- Do one step, then stop and report. The next step waits for the user.
- A step is done when: the four checks and `npm run check:core` pass, the matching docs are updated (CLAUDE.md, Documentation), and the plan has an **As built** line (what actually shipped, any deviation and why) and a **Status**.
- Report deviations from the plan up front, and anything spotted outside the step (a leftover string, a stale doc) rather than silently widening the step.
- **No legacy in the code.** A data format change ships with a one-shot script under `scripts/` (dry run by default, `--apply`, validated, atomic write, idempotent) that runs with the bot stopped, before the new code starts. The code reads only the new format. Old names are renamed everywhere: code, UI, prompts, docs.
- Never run a migration on real data without a backup, and say where the backup is.

## 4. Ship

Only when the user asks.

1. **Branch**: never commit on `main`. `git checkout -b feat/<topic>` (or `fix/`, `refactor/`, `docs/`).
2. **Checks**: the four checks and `npm run check:core`, clean.
3. **Stage by path** after reading `git status`: the user sometimes stages part of the work themselves; don't unstage it.
4. **Commit**, gitmoji, one commit per branch (CLAUDE.md, Conventions). Pick the emoji from the change's nature, as in `git log --oneline`:

    | Emoji        | For                             |
    | ------------ | ------------------------------- |
    | `:sparkles:` | a new feature                   |
    | `:bug:`      | a fix                           |
    | `:recycle:`  | a refactor, no behaviour change |
    | `:truck:`    | a rename or a move              |
    | `:memo:`     | docs or prompts only            |
    | `:lipstick:` | wording or display only         |

    Title in English, imperative, no `(#NN)`: GitHub appends it on the squash merge. Body: a short bullet per change, then any deploy constraint (re-register, migration order). End with the `Co-Authored-By` line.

    The repo's gitmoji `prepare-commit-msg` hook prints `/dev/tty: Device not configured` outside an interactive terminal. The commit still goes through with the message unchanged; check with `git log -1`.

5. **Push**: `git push -u origin <branch>`, then give the user the PR creation URL, `https://github.com/PerthuisQuentin/TLH-Bot/pull/new/<branch>`. Don't open the PR.
6. **Remind** what is left on their side, in order: re-register (`npm run register`, then `register:prod`) if a command definition changed, backup and migration before the deploy if the data format changed.

## Closing the topic

Once everything is shipped: fold what is still worth knowing (the why, the calibration, the rejected variants) into the permanent docs (`docs/shells.md`, `docs/prestige-design.md`, …), then delete the working doc and any one-shot script that has run in every environment. Git history keeps both.
