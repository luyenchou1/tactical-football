# Tactical Football prototype — handoff

One-time bridging doc from the original sandbox session (Claude Code on the
web, branch `claude/tactical-football-game-design-6L7AS`) to the next session
(Claude Code running locally in `~/Code/DeweyLearn-cluster`). Delete this file
once the next session has picked up and you've made any further decisions —
it captures a moment in time, not a permanent design doc.

## What this branch is

An exploratory side-project under `prototypes/`, **not** part of the
DeweyLearn Cluster recording app. The goal: prove out a turn-based tactical
American football game (think XCOM-meets-football) by fully resolving exactly
one play — Quick Slant vs Cover 1 Man — through the full matchup chain we'd
want on screen:

```
T0 snap → T1 stem → T2 separation + LB undercut → T3 throw quality
                                                → T4 catch / PBU / INT
                                                → T5 YAC
```

The `prototypes/` directory is intentionally isolated — nothing here links
against the host app, and the whole folder can be deleted without touching
Cluster.

## What's in the box

Two independent prototypes, both targeting the same play and using the same
math:

### 1. `prototypes/TacticalFootball/` — Swift headless simulator

- SwiftPM package, `swift run TacticalFootball` from the folder.
- Single-play verbose trace, batch mode (`--batch 5000`), tier matrix
  (`--matrix`), seeded RNG (`--seed 42`).
- See `prototypes/TacticalFootball/README.md` for the calibration matrix —
  monotonic on both axes, elite-vs-elite plays as a contest, elite-vs-poor is
  a layup.
- **Has never been compiled.** Swift wasn't available on the sandbox machine
  where this was authored. The math was validated end-to-end against a Python
  mirror (`validation/simulate.py`). First task on the Mac: `swift build` and
  fix any compile errors.

### 2. `prototypes/tactical-football-web/` — playable HTML prototype

- Static page, no build step. `python3 -m http.server` from the folder and
  open `http://localhost:8000`.
- Same math as the Swift sim, ported to `sim.js`.
- Pre-snap leverage read (CB outside vs inside), three route choices
  (slant / hitch / out), animated tick-by-tick reveal, post-play breakdown.
- Headless verifiers (`verify-layout.mjs`, `verify-visual.mjs`) — Puppeteer
  scripts that snap screenshots and assert layout invariants. Useful when
  iterating on the UI.

## Key decisions already made (don't relitigate without reason)

1. **One play, fully resolved, before anything else.** No menu screens, no
   roster screens, no playbook UI, no second coverage, no second route, no
   fatigue/momentum/weather/clock. The matchup chain is the product; prove
   it works, then layer.
2. **Math lives in two languages.** Swift is the target; Python mirror is
   for validating distributions without a Swift toolchain. JavaScript port
   is for the browser playable. If you change a formula, change all three
   and re-run the matrix.
3. **Ratings are 0–99, normalized internally to a roll-under d100 system.**
   See `Simulation.swift` → `Dice.checkMargin`.
4. **Five players matter per play.** Slot WR, QB, slot CB, MLB, FS. The other
   17 hold defaults and will surface visually but don't roll.
5. **Cover 1 Man only, Quick Slant only.** Adding a second route or coverage
   means re-deriving the calibration matrix; don't do it casually.

## State of validation

- Swift code: **not compiled.** Written carefully against the Python mirror
  but no `swift build` ever ran on it.
- Python mirror: produces the calibration matrix in the README. Run
  `python3 validation/simulate.py --matrix` to reproduce.
- HTML prototype: layout verifier and visual verifier both pass (last run
  2026-05-30). Manually playable end-to-end — pre-snap → snap → tick reveal
  → post-play breakdown → next play.

## Sandbox-only artifacts you can ignore

The original session ran in a Linux sandbox isolated from the Mac. It
produced two commits on `claude/tactical-football-game-design-6L7AS` that
were **never pushed** (the sandbox has no write access to the remote and
they were branched off v2.0.3, which is stale). Those commits are being
discarded — this folder is the deliverable. The work landing on `main` (or
wherever you branch from now) should be a single fresh commit off the
current tip, not a merge of the sandbox history.

## How this got here

The tarball `tactical-football-prototypes.tar.gz` (26 KB) was untarred into
the `prototypes/` directory of your local checkout. If you're reading this
and you don't see the two folders side-by-side with HANDOFF.md, the extract
didn't happen — see "Bringing it in" below.

### Bringing it in (if not already done)

From the repo root, on a fresh branch off current main:

```bash
git checkout main && git pull
git checkout -b tactical-football-prototype
tar -xzf ~/Downloads/tactical-football-prototypes.tar.gz   # path varies
git add prototypes/
git commit -m "Add tactical football prototype (Swift sim + HTML playable)"
```

## Suggested next steps (pick one, not all)

In rough order of leverage:

1. **Compile the Swift sim on your Mac.** `cd prototypes/TacticalFootball &&
   swift build && swift run TacticalFootball --matrix`. Fix any compile
   errors, confirm the matrix matches the Python output, commit the fixes.
   *(Highest leverage — unblocks everything Swift-side.)*
2. **Decide the next layer.** Two reasonable directions:
   - **SwiftUI iPhone screen** rendering the same `PlayResult` chain
     (pre-snap field, tick reveal animation, post-play breakdown). Mirrors
     the HTML prototype but native. This is the path toward a real app.
   - **Second play or second coverage** in the headless sim (e.g. Hitch vs
     Cover 3, or Slant vs Cover 2). Expands the math foundation before
     building UI on top of it.
3. **Stress-test the calibration.** Run `--matrix` with 20,000 plays per
   cell and look for non-monotonicities, then tune.
4. **Polish the HTML prototype** into something genuinely shareable — sound,
   better animations, a "season mode" with a few opponents. Risk: it becomes
   a distraction from the native target.

## Gotchas

- **Do not** merge the discarded sandbox branch — branch fresh off main.
- **Do not** copy this work into the main Cluster app target. It lives in
  `prototypes/` deliberately; the app's CLAUDE.md describes a recording app
  and none of this code belongs in that codebase's runtime path.
- The Python mirror uses stdlib only. Don't add deps to it — its whole point
  is being trivially runnable.
- The HTML prototype's verifier scripts need Puppeteer
  (`npm i -D puppeteer`); `.gitignore` already excludes `node_modules/`.
