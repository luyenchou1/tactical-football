# Tactical Football

Turn-based tactical American football for mobile — think **XCOM-meets-football**. You read each defender's **leverage** and the disguised look, call a play, and **set** — the defense declares its true coverage (a man look can roll to Cover 3) so you can **audible** — then **hike** and find the open man in a short window before the pass rush gets home, all resolved through a chain of rating-driven dice rolls.

> **Status:** playable, and now juicy. A 9-play book over 13 routes — including deep shots (go, post, corner) and an RB screen — 3 **disguised** defensive looks you diagnose **post-snap** in a timed read window, a pass rush + sacks, interceptions on forced reads, and a 5-round game vs a CPU opponent — wrapped in an arcade audiovisual layer (NES field, procedural 8-bit sound, an announcer, screen shake, confetti, and NBA-Jam-style callouts). The matchup math runs in two engines (JS + a Python mirror) kept in sync and guarded by a test suite.

## Play it

**▶ Play it live: https://luyenchou1.github.io/tactical-football/** — open it on your phone and **Add to Home Screen** to install it (works offline once installed).

A game is **5 rounds**: each round you get a possession, then the opponent gets one. Read the defenders' **leverage** and the disguised look, call a play, then **set** — the coverage declares (**man**, **Cover 3 zone**, or **blitz**) and can rotate, so **audible** if it shifted — then **hike** and find whoever wins his matchup before the pass rush gets home. Outscore them; your best score is saved.

Run it locally (static web app — no build step, no dependencies):

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000   (append ?fast to skip the play animations)
```

After each play, plain-English color commentary explains *why* it worked or failed, and an **instant replay** lets you scrub the play back in slow-mo — with the roll-by-roll breakdown alongside, the matching phase highlighting as you step.

## What's in here

| Path | What it is |
|------|------------|
| `web/` | **The game.** Vanilla HTML/CSS/JS, mobile-first, installable PWA. This is the thing you run. |
| `sim/` | Headless Swift simulator + a Python mirror of the same math. The design & calibration reference. |
| `docs/HANDOFF.md` | Origin notes from the first prototype session (kept for history). |

## How a play resolves

```
pre-snap: read leverage + the look → call a play
set → defense DECLARES its true coverage (a man look can roll to Cover 3) → AUDIBLE if it shifted
hike → READ WINDOW: routes develop, the open man pulls away → throw before the rush
     → separation roll → catch / PBU / INT → yards after catch
```

The read happens in beats. **Pre-snap**, each defender shows his **leverage** (the shoulder he's shading — outside leverage begs for a slant, inside for an out) and the shell shows a press/off/creep that hints man, zone, or blitz — but the look can **bluff**. You read it and call a **play**, then **SET**: the defense **declares** its true coverage and can *rotate* — a man look rolling to Cover 3, corners bailing or creeping. If the shift beat your call, **audible** to a better play; then **HIKE**. A short, forgiving **read window** opens — every defender trails his receiver by the separation the matchup earns, so the **open man visibly pulls away** while a covered one stays glued (everyone but the five matchups dims so it reads clearly) — and you tap him before the rush gets home.

- **vs man** — the route that breaks *away* from its defender's leverage comes open (slant beats outside, out beats inside); a drag/flat beats man underneath. Force a route *into* leverage and it can be picked.
- **vs Cover 3 zone** — the route that settles in a soft spot comes open (hitch, curl, flat); the out runs into the curl-flat defender.
- **vs a blitz** — a defender vacates, so a **quick** throw (slant, drag, the back) is wide open — or take a **deep shot** into the thinned coverage if you'll risk the sack.
- **deep shots (go / post / corner)** — slow to develop, so every one is a sack gamble: a **post** or **corner** beats man leverage *down the field* and finds the Cover-3 seam, while a **go** is a pure speed race best when a blitz thins the help. Read it right and it's a chunk play; force it into coverage and it's the most interceptable ball in the game.

Every route has a time-to-throw, so depth costs time: holding the deep **dig** lets the rush home (~8% sack in base coverage, ~19% vs a blitz) while a quick slant is ~1%; dither past the window and you're sacked outright. The openness cue you read in the window comes from the *same* read math surfaced in the post-play breakdown — what you see is what you get. After the whistle, **plain-English color commentary** tells you *why* it worked or failed — a misread look, the wrong target, personnel, or just the dice — and an **instant replay** lets you scrub the play back in slow-mo to verify it with your own eyes, the KPI breakdown alongside.

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

**Risk & balance** (measured, not asserted): a deep dig carries ~8% sack risk in base coverage (~19% vs a blitz) vs ~1% on a quick slant; forcing a route into coverage is intercepted ~1.5% vs ~0.4% on a good read. At the game level a random play-masher wins ~47%, reading the coverage wins ~70%, and always bombing deep is a break-even ~50% — the read matters more than ever (a deep shot rewards a correct read and punishes a forced one), and nothing dominates.

Reproduce / verify:

```bash
python3 sim/validation/simulate.py rps      # route × coverage grid (cmp / INT / sack / EV)
python3 sim/validation/simulate.py matrix   # WR×CB tier sweep (slant vs man)
cd web && npm test                          # engine invariants + calibration & risk snapshots
cd web && npm run balance                   # drive-level win-rate per strategy
```

## Arcade feel

The whole thing is wrapped in a Tecmo-meets-NBA-Jam audiovisual layer — mostly procedural, with a handful of small recorded SFX clips (the snap cadence, hits, catches, whistle, and crowd reactions) layered over the synth, which stays as the always-available fallback:

- **Look:** bright NES grass that fills the frame, painted yard numbers, chunky flat-token chips, a broadcast HUD, pixel + terminal fonts, a cartridge bezel, and a subtle CRT scanline + vignette finish.
- **Sound:** **16-bit-style FM SFX** — a small Web Audio synth (FM carriers for a brassy/metallic body, detuned unison for width, filter envelopes for movement, a convolver reverb send for space) gives each event a Genesis/SNES voice, layered with noise transients + raw sub thumps for impact ([ZzFX](https://github.com/KilledByAPixel/ZzFX) handles the simplest bits). **Organic touches:** formant-synthesized **QB grunts** on a sack, a **leather-on-pads thwack** on the catch, a **body-thud** on a big hit, and the crowd's disappointed **"Ohhh"** on a drop (a shocked gasp on a pick) — plus a **dynamic procedural crowd** (filtered noise through the ZzFX audio graph) that *swells* as a deep ball hangs, *erupts* on a score, and *groans* on a pick — over an ascending **touchdown fanfare**, a big-play riser, and a first-down ding. A `speechSynthesis` **announcer** calls the big beats ("Touchdown!", "Picked off!", "Big gainer!"). **Recorded clips** layer real audio over the synth where it counts — the snap **"hut!"**, ball-on-pads **catches**, **hits/tackles**, the ref's **whistle**, the crowd's **roar** on a touchdown and **"Ohhh"** on a drop — each decoded on first touch, round-robined, and falling back to the procedural version if it hasn't loaded. Underneath it all, a long **recorded crowd-murmur loop** (begun at a random section each game) forms a stadium bed that breathes with the play — it **recedes while you pick a play, swells as the play runs, and pops on a completion**, then settles — with a **stadium band** that strikes up sporadically (a random ~11s section) during the pre-snap downtime. A 🔊/🔇 toggle; mute is remembered. *(The announcer is wired so recorded VO clips can drop in later.)*
- **Juice:** a **choreographed touchdown** — flash → SLAM → confetti → the crowd erupts → the scorer leaps while the coverage sags → the score ticks — plus a **big-play tier** for explosive 20+ yard gains (callout + riser + crowd swell), hit-pause on contact, trauma screen-shake, impact flashes, **SLAM callouts** (TOUCHDOWN! / BIG PLAY! / PICKED OFF! / SACKED! / DIME!), a particle layer (TD confetti, sack dust, INT shards, catch sparks), chip pop/squash, and an **on-fire streak** (three great reads in a drive → 🔥).

It respects `prefers-reduced-motion` (shake/particles/slam off, feedback kept) and a `?fast` URL flag (skips the reveal for quick play/testing).

## Roadmap

- [x] One play fully resolved (Quick Slant vs Cover 1 Man), validated math
- [x] Playable web prototype: pre-snap read, animated tick reveal, post-play breakdown
- [x] Installable, offline-capable PWA (manifest + service worker)
- [x] Drive + scoreboard loop: downs, first downs, goal-to-go, touchdowns, turnover on downs
- [x] Game arc: multi-round games with a saved high score
- [x] Second coverage (Cover 3 zone): the read flips — hitch beats zone, leverage beats man
- [x] An opponent (abstracted CPU possessions) for a true win/lose result
- [x] Playbook (9 plays, 13 routes) — pick a play and target any of 5 receivers
- [x] Risk/reward: pass rush + pocket clock (sacks), the blitz, and INTs on forced reads
- [x] Tuned opponent, a zero-dep Node test harness, and a drive-level balance sim
- [x] Arcade audiovisual layer: NES re-skin + pixel fonts, procedural sound + announcer + menu music, screen shake, particles, SLAM callouts, on-fire streak, painted field + CRT finish
- [x] Celebration & crowd pass — a reactive procedural crowd (swells on a deep ball, erupts on a score, groans on a pick), a TD fanfare + big-play riser, a choreographed touchdown, and an explosive-play tier
- [x] Multichannel SFX pass — layered voices (tonal body + noise transient + sub thump), arpeggiated rewards, raw-WebAudio impacts, from a retro-arcade SFX research sprint
- [x] 16-bit FM sound engine — a Web Audio FM/subtractive synth (FM operators, detuned unison, filter envelopes, convolver reverb) re-voicing every event for a Genesis/SNES feel
- [x] Organic football SFX — formant-synthesized QB grunts, a leather-on-pads catch, body-thud tackles, and crowd "Ohhh"/gasp reactions (from a procedural-audio research sprint)
- [x] Ambient crowd bed — two recorded crowd loops layered as a continuous low stadium hum (a procedural noise murmur and a procedural music bed were both tried and cut — one droned like a jet engine, the other read as ominous sci-fi)
- [x] Arcade shell — a unified two-font type system (pixel **chrome** for fixed labels/scores vs terminal **feed** for runtime prose/numbers), an attract/**START** screen (1-player vs a dimmed 2-player, a band fight-song), and a broadcast **end-game card** (winner headline, score, a letter grade, and **top performers** off a live per-player box score)
- [x] Read legibility (colored verdicts) + outcome juice (pop + haptics)
- [x] Post-snap reads — find the open man by his separation in a timed read window (no spoiler colors)
- [x] Pre-snap tells & bluffs — press/off corners + a creeping LB hint the coverage and bluff ~1 in 4
- [x] Leverage cues + snap rotation + **audible** — read each defender's shade; the coverage declares (man↔Cover 3) at the line and you can audible to adjust
- [x] Post-play color commentary — explains *why* each play worked (scheme / read / personnel / luck)
- [x] Instant replay — scrub/step the play back in slow-mo, KPI breakdown synced to each frame
- [ ] Coach both sides — call defense on the opponent's possessions
- [x] Deep shots — go / post / corner verticals: the post/corner leverage read downfield, Four Verticals + Smash, the shot as the blitz answer (tuned so blind bombing stays break-even)
- [x] Playbook II — an RB **screen** (the blitz-beater mirror of the bomb: a dedicated sack/INT-proof branch that's a chunk vs the vacated blitz but a wasted down vs a disciplined front), a **Flood** (corner/sail/flat sideline stretch — a new *shape* of zone-beater), and an RB **Wheel** (a man-beater that finally varies the back off the flat)
- [x] Player profiles & tuning — a **TUNE YOUR SQUAD** screen off the start menu: allocate a 15-point bonus pool across the offense's *engine-live* attributes only (each with a one-line "what it does" caption — no fake knobs; ARM/STA stay display-only), capped at 99, persisted per device; tap any chip in-game for a **profile card** with gold tuning badges and a live box-score line (REC/YDS/TD/TGT; the QB gets a derived passing line incl. INTs and sacks)
- [x] 8-bit player portraits — procedural pixel busts (a 16×18 canvas grid, no image assets): every player gets a hand-tuned look (skin tone, brow attitude, facial hair, eye black, helmet stripes, a mirrored visor on the lockdown corner) on the profile cards and the roster screen
- [ ] Safety help in the model — a true single-high robber bracketing the deep post

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
