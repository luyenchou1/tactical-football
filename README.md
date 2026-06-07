# Tactical Football

Turn-based tactical American football for mobile — think **XCOM-meets-football**. The defense disguises its coverage behind a pre-snap *look* that can bluff — you read the look, call a play, **snap the ball**, and find the open man in a short window before the pass rush gets home, then watch it resolve through a chain of rating-driven dice rolls.

> **Status:** playable, and now juicy. A 4-play book over 7 routes, 3 **disguised** defensive looks you diagnose **post-snap** in a timed read window, a pass rush + sacks, interceptions on forced reads, and a 5-round game vs a CPU opponent — wrapped in an arcade audiovisual layer (NES field, procedural 8-bit sound, an announcer, screen shake, confetti, and NBA-Jam-style callouts). The matchup math runs in two engines (JS + a Python mirror) kept in sync and guarded by a test suite.

## Play it

**▶ Play it live: https://luyenchou1.github.io/tactical-football/** — open it on your phone and **Add to Home Screen** to install it (works offline once installed).

A game is **5 rounds**: each round you get a possession, then the opponent gets one. The coverage is **disguised** behind a pre-snap look (press vs off corners, a creeping linebacker) that can bluff — read it, call a play, snap, then find whoever wins his matchup (**man**, **Cover 3 zone**, or **blitz**) before the pass rush gets home. Outscore them; your best score is saved.

Run it locally (static web app — no build step, no dependencies):

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000   (append ?fast to skip the play animations)
```

After each play, plain-English color commentary explains *why* it worked or failed; tap **Show the tape** for the full roll-by-roll breakdown.

## What's in here

| Path | What it is |
|------|------------|
| `web/` | **The game.** Vanilla HTML/CSS/JS, mobile-first, installable PWA. This is the thing you run. |
| `sim/` | Headless Swift simulator + a Python mirror of the same math. The design & calibration reference. |
| `docs/HANDOFF.md` | Origin notes from the first prototype session (kept for history). |

## How a play resolves

```
pre-snap: read the look (press / off / creep — can bluff) → call a play
snap → coverage declares → READ WINDOW: routes develop, the open man pulls away
     → you throw (or hold too long → sacked) → separation roll
     → catch / PBU / INT → yards after catch
```

The read happens in two beats. **Pre-snap**, the defense shows a disguised *look*: **press** corners (tight) hint man, **off** corners (a cushion) hint zone, and a **creeping linebacker** hints blitz — but the look bluffs about 1 in 4 snaps, so it's an edge, not a certainty. You call a **play** (which assigns all five receivers a route) on that read. **At the snap** the coverage declares itself and a short, forgiving **read window** opens: every defender trails his receiver by the separation the matchup earns, so the **open man visibly pulls away** while a covered one stays glued (everyone but the five matchups dims so it reads clearly). Tap the open man — by jersey number on the field or the live target row — before the rush gets home.

- **vs man** — the route that breaks *away* from its defender's leverage comes open (slant beats outside, out beats inside); a drag/flat beats man underneath. Force a route *into* leverage and it can be picked.
- **vs Cover 3 zone** — the route that settles in a soft spot comes open (hitch, curl, flat); the out runs into the curl-flat defender.
- **vs a blitz** — a defender vacates, so a **quick** throw is wide open — or take a **deeper shot** for more yards if you'll risk the sack.

Every route has a time-to-throw, so depth costs time: holding the deep **dig** lets the rush home (~8% sack in base coverage, ~19% vs a blitz) while a quick slant is ~1%; dither past the window and you're sacked outright. The openness cue you read in the window comes from the *same* read math surfaced in the post-play breakdown — what you see is what you get. After the whistle, **plain-English color commentary** tells you *why* it worked or failed — a misread look, the wrong target, personnel, or just the dice — with the full KPI breakdown a tap away.

## Calibration

The math is tuned so that rating spread maps to a believable completion-rate gradient. A 2,000-play sweep (slot WR tier × slot CB tier, QB/LB held at "good"):

| WR ↓ / CB → | elite | good | avg | below | poor |
|:--|:-:|:-:|:-:|:-:|:-:|
| **elite**   | 66% | 73% | 80% | 87% | 86% |
| **good**    | 63% | 64% | 73% | 81% | 87% |
| **average** | 54% | 58% | 67% | 67% | 77% |
| **below**   | 48% | 52% | 57% | 63% | 68% |
| **poor**    | 35% | 42% | 44% | 55% | 56% |

Monotonic on both axes; elite-vs-elite plays as a real contest, elite-vs-poor is a layup.

**Risk & balance** (measured, not asserted): a deep dig carries ~8% sack risk in base coverage (~19% vs a blitz) vs ~1% on a quick slant; forcing a route into coverage is intercepted ~1.5% vs ~0.4% on a good read. At the game level a random play-masher wins ~51%, reading the coverage wins ~65%, and always bombing deep wins ~50% — the read matters and nothing dominates.

Reproduce / verify:

```bash
python3 sim/validation/simulate.py rps      # route × coverage grid (cmp / INT / sack / EV)
python3 sim/validation/simulate.py matrix   # WR×CB tier sweep (slant vs man)
cd web && npm test                          # engine invariants + calibration & risk snapshots
cd web && npm run balance                   # drive-level win-rate per strategy
```

## Arcade feel

The whole thing is wrapped in a Tecmo-meets-NBA-Jam audiovisual layer — all procedural, the only assets are two small pixel webfonts:

- **Look:** bright NES grass that fills the frame, painted yard numbers, chunky flat-token chips, a broadcast HUD, pixel + terminal fonts, a cartridge bezel, and a subtle CRT scanline + vignette finish.
- **Sound:** 8-bit SFX synthesized with [ZzFX](https://github.com/KilledByAPixel/ZzFX) (snap, throw, catch, sack, pick, touchdown fanfare, crowd) plus a `speechSynthesis` **announcer** on the big beats ("Touchdown!", "Picked off!", "Dime!"), over a gentle procedural menu-music loop that plays while you read the defense and ducks for the snap. A 🔊/🔇 toggle in the corner; mute is remembered.
- **Juice:** hit-pause on contact, trauma screen-shake, impact flashes, **SLAM callouts** (TOUCHDOWN! / PICKED OFF! / SACKED! / DIME!), a particle layer (TD confetti, sack dust, INT shards, catch sparks), chip pop/squash, and an **on-fire streak** (three great reads in a drive → 🔥).

It respects `prefers-reduced-motion` (shake/particles/slam off, feedback kept) and a `?fast` URL flag (skips the reveal for quick play/testing).

## Roadmap

- [x] One play fully resolved (Quick Slant vs Cover 1 Man), validated math
- [x] Playable web prototype: pre-snap read, animated tick reveal, post-play breakdown
- [x] Installable, offline-capable PWA (manifest + service worker)
- [x] Drive + scoreboard loop: downs, first downs, goal-to-go, touchdowns, turnover on downs
- [x] Game arc: multi-round games with a saved high score
- [x] Second coverage (Cover 3 zone): the read flips — hitch beats zone, leverage beats man
- [x] An opponent (abstracted CPU possessions) for a true win/lose result
- [x] Playbook (4 plays, 7 routes) — pick a play and target any of 5 receivers
- [x] Risk/reward: pass rush + pocket clock (sacks), the blitz, and INTs on forced reads
- [x] Tuned opponent, a zero-dep Node test harness, and a drive-level balance sim
- [x] Arcade audiovisual layer: NES re-skin + pixel fonts, procedural sound + announcer + menu music, screen shake, particles, SLAM callouts, on-fire streak, painted field + CRT finish
- [x] Read legibility (colored verdicts) + outcome juice (pop + haptics)
- [x] Post-snap reads — find the open man by his separation in a timed read window (no spoiler colors)
- [x] Pre-snap tells & bluffs — press/off corners + a creeping LB hint the coverage and bluff ~1 in 4
- [x] Post-play color commentary — explains *why* each play worked (scheme / read / personnel / luck); KPI tape on demand
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
