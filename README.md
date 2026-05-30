# Tactical Football

Turn-based tactical American football for mobile — think **XCOM-meets-football**. You read the defense, pick your move, and watch a single play resolve through a chain of rating-driven dice rolls: snap → separation → throw → catch → yards after catch.

> **Status:** early prototype. One play (the Quick Slant family vs Cover 1 Man) is fully playable in the browser. The matchup math is validated and calibrated against rough NFL priors.

## Play it

**▶ Play it live: https://luyenchou1.github.io/tactical-football/** — open it on your phone and **Add to Home Screen** to install it (works offline once installed).

A game is a **6-drive challenge**: read the defense, call the route, and score as many touchdowns as you can. You get a letter grade and a saved high score at the end.

Run it locally (static web app — no build step, no dependencies):

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000   (append ?fast to skip the play animations)
```

Every roll is shown in the post-play breakdown — tap a row to see the math behind it.

## What's in here

| Path | What it is |
|------|------------|
| `web/` | **The game.** Vanilla HTML/CSS/JS, mobile-first, installable PWA. This is the thing you run. |
| `sim/` | Headless Swift simulator + a Python mirror of the same math. The design & calibration reference. |
| `docs/HANDOFF.md` | Origin notes from the first prototype session (kept for history). |

## How a play resolves

```
T0 snap → T1 stem → T2 separation + LB undercut → T3 throw quality
                                                → T4 catch / PBU / INT
                                                → T5 YAC
```

The core "chess move" is pre-snap: you read the slot CB's **leverage** (shading inside or outside) and pick the slot receiver's route. Break *away* from his leverage and you win separation; break *into* it and you're covered. Ratings (0–99) feed a roll-under d100 resolution, and every roll is surfaced in the post-play breakdown so the outcome is legible, not a black box.

## Calibration

The math is tuned so that rating spread maps to a believable completion-rate gradient. A 2,000-play sweep (slot WR tier × slot CB tier, QB/LB held at "good"):

| WR ↓ / CB → | elite | good | avg | below | poor |
|:--|:-:|:-:|:-:|:-:|:-:|
| **elite**   | 66% | 73% | 80% | 87% | 86% |
| **good**    | 63% | 64% | 73% | 81% | 87% |
| **average** | 54% | 58% | 67% | 67% | 77% |
| **below**   | 48% | 52% | 57% | 63% | 68% |
| **poor**    | 35% | 42% | 44% | 55% | 56% |

Monotonic on both axes; elite-vs-elite plays as a real contest, elite-vs-poor is a layup. Reproduce it:

```bash
python3 sim/validation/simulate.py matrix
```

## Roadmap

- [x] One play fully resolved (Quick Slant vs Cover 1 Man), validated math
- [x] Playable web prototype: pre-snap read, animated tick reveal, post-play breakdown
- [x] Installable, offline-capable PWA (manifest + service worker)
- [x] Drive + scoreboard loop: downs, first downs, goal-to-go, touchdowns, turnover on downs
- [x] Game arc: 6-drive challenge with a final grade and a saved high score
- [ ] Second coverage (Cover 2 / Cover 3) to deepen the pre-snap read
- [ ] A simple opponent (CPU score) for a true win/lose result
- [ ] More plays and routes

## The Swift simulator

`sim/` is a SwiftPM headless simulator written alongside the web version, with a Python mirror in `sim/validation/` that needs no toolchain. The Python mirror runs anywhere with Python 3. Building the Swift target requires a working Swift toolchain (matched Command Line Tools or full Xcode):

```bash
cd sim
swift run TacticalFootball            # single play, verbose trace
swift run TacticalFootball -- --matrix  # tier sweep
```

## License

MIT — see [LICENSE](LICENSE).
