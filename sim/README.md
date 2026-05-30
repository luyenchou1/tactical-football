# Tactical Football — prototype

Turn-based tactical American football, headless v1. One play, fully resolved
through the matchup chain we want to put on screen:

```
T0 snap → T1 stem → T2 separation + LB undercut → T3 throw quality
                                                → T4 catch / PBU / INT
                                                → T5 YAC
```

The play modelled here is **Quick Slant vs Cover 1 Man**. The slot WR runs
a 5-yard slant against a slot CB playing outside leverage with a single high
safety and an MLB underneath who may or may not jump the throwing window.

This package is intentionally self-contained — it does not link against
DeweyLearn Cluster, and lives under `prototypes/` so it can be deleted or
extracted without touching the host app.

## Run

Requires Swift 5.9+ (Xcode 15+).

```bash
cd prototypes/TacticalFootball

# One play, verbose trace
swift run TacticalFootball

# Batch of N plays, summary stats
swift run TacticalFootball -- --batch 5000

# Tier matrix — 5x5 WR-tier × CB-tier sweep, 2000 plays each
swift run TacticalFootball -- --matrix

# Reproducible — pin the RNG
swift run TacticalFootball -- --seed 42
```

## What the math is supposed to produce

Calibrated against rough NFL slot-slant priors. Numbers below are from a
2000-play tier sweep with the Python mirror (`validation/simulate.py`).

| WR tier ↓ / CB tier → | elite | good  | average | below | poor  |
|----------------------:|:-----:|:-----:|:-------:|:-----:|:-----:|
| **elite**             | 66%   | 73%   | 80%     | 87%   | 86%   |
| **good**              | 63%   | 64%   | 73%     | 81%   | 87%   |
| **average**           | 54%   | 58%   | 67%     | 67%   | 77%   |
| **below**             | 48%   | 52%   | 57%     | 63%   | 68%   |
| **poor**              | 35%   | 42%   | 44%     | 55%   | 56%   |

(Completion %. INT rate stays under ~1% across every cell — slants are quick.)

Monotonic on both axes, elite-vs-elite plays as a real contest, elite-vs-poor
is a layup. That's the rating spread the player card needs to convey.

## Files

- `Sources/TacticalFootball/Player.swift` — `Player`, `Rating`, `Position`, `Tier`.
- `Sources/TacticalFootball/Plays.swift` — `Route`, `Coverage`, `OffensivePlay` (declared but not yet used by the v1 sim — they're shape for the playbook UI).
- `Sources/TacticalFootball/Simulation.swift` — `SeededRNG`, `Dice`, `ThrowQuality`, `PlayResult`, `TickEvent`.
- `Sources/TacticalFootball/SlantVsCover1.swift` — the play simulator. Every roll is annotated; tune in here.
- `Sources/TacticalFootball/DemoPlayers.swift` — position-aware factory functions for building demo rosters by tier.
- `Sources/TacticalFootball/main.swift` — CLI entry: single play / batch / matrix.
- `validation/simulate.py` — Python mirror of the same math. Run with stdlib Python 3, no deps. Used to validate distributions when iterating on the formulas without a Swift toolchain handy.

## What's missing on purpose

Anything that doesn't move the math or the matchup chain is deferred:

- No field rendering, no UI, no SwiftUI.
- No fatigue / momentum / weather / clock.
- Only one coverage scheme resolves (Cover 1 Man).
- Only one play resolves (Quick Slant).
- No pre-snap audibles, motion, or hot routes.
- Penalties, fumbles, special teams — all absent.

Next layer: SwiftUI iPhone screen rendering the same `PlayResult` chain
(pre-snap field, tick reveal animation, post-play breakdown).

## A note on this v1 commit

Swift was not available on the machine where this was authored, so the Swift
sources have been written carefully but not compiled. The math has been
validated end-to-end via the Python mirror in `validation/`. Build on your
Mac and report any compile errors back.
