# Tactical Football

Turn-based tactical American football for mobile — think **XCOM-meets-football**. You read the defense, pick your move, and watch a single play resolve through a chain of rating-driven dice rolls: snap → separation → throw → catch → yards after catch.

> **Status:** early prototype. One play (the Quick Slant family vs Cover 1 Man) is fully playable in the browser. The matchup math is validated and calibrated against rough NFL priors.

## Play it

**▶ Play it live: https://luyenchou1.github.io/tactical-football/** — open it on your phone and **Add to Home Screen** to install it (works offline once installed).

A game is **5 rounds**: each round you get a possession, then the opponent gets one. Read the defense (man or Cover 3 zone), call a play, target the open receiver, and outscore them. Your best score is saved.

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

The core "chess move" is pre-snap. The defense lines up in **man (Cover 1)** or **zone (Cover 3)**; you call a **play** (which assigns all five eligible receivers a route) and pick **who to throw to**, reading each matchup:

- **vs man** — target a receiver whose route breaks *away* from his defender's leverage (slant beats outside, out beats inside), or a drag/flat that beats man underneath.
- **vs Cover 3 zone** — target a route that settles in a soft spot (hitch, curl, flat); the out runs into the curl-flat defender.

Routes (slant, hitch, out, drag, dig, curl, flat) and ratings (0–99) feed a roll-under d100 resolution, and every roll is surfaced in the post-play breakdown so the outcome is legible, not a black box.

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
python3 sim/validation/simulate.py matrix   # WR×CB tier sweep (slant vs man)
python3 sim/validation/simulate.py rps      # route × coverage win-rate grid
```

## Roadmap

- [x] One play fully resolved (Quick Slant vs Cover 1 Man), validated math
- [x] Playable web prototype: pre-snap read, animated tick reveal, post-play breakdown
- [x] Installable, offline-capable PWA (manifest + service worker)
- [x] Drive + scoreboard loop: downs, first downs, goal-to-go, touchdowns, turnover on downs
- [x] Game arc: multi-round games with a saved high score
- [x] Second coverage (Cover 3 zone): the read flips — hitch beats zone, leverage beats man
- [x] An opponent (abstracted CPU possessions) for a true win/lose result
- [x] Playbook (4 plays, 7 routes) — pick a play and target any of 5 receivers
- [ ] Post-snap reads — pick who comes open as the play develops
- [ ] Disguised coverage — pre-snap tells and bluffs to read
- [ ] Coach both sides — call defense on the opponent's possessions
- [ ] Deep shots (go / post / corner) with safety help in the model

## The Swift simulator

`sim/` is a SwiftPM headless simulator with a Python mirror in `sim/validation/` that needs no toolchain.

> **Note:** the Swift target currently models only Cover 1 / the slant — it predates the web build. The **Python mirror and `web/sim.js` are the current source of truth** (they include Cover 3 and the man/zone route reads). Sync the Swift sources once a Swift toolchain is available.

The Python mirror runs anywhere with Python 3. Building the Swift target requires a working Swift toolchain (matched Command Line Tools or full Xcode):

```bash
cd sim
swift run TacticalFootball            # single play, verbose trace
swift run TacticalFootball -- --matrix  # tier sweep
```

## License

MIT — see [LICENSE](LICENSE).
