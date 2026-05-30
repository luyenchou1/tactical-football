#!/usr/bin/env python3
"""
Python mirror of the Tactical Football matchup math. Stdlib only — no deps —
so it runs anywhere Python 3 does and validates the distributions the JS/Swift
engines should reproduce.

It resolves ONE play (slot receiver route vs a single underneath defender + LB)
against one of two coverages:

  man   — Cover 1: the slot defender plays man with a leverage (inside/outside).
          The chess move is to break AWAY from his leverage.
  zone  — Cover 3: defenders play areas. The hitch settles in the soft spot
          (zone-beater), the slant works underneath, the out gets jumped by the
          curl-flat defender.

Run:
    python3 simulate.py                      # one slant vs man, verbose
    python3 simulate.py rps                   # route x coverage win-rate grid
    python3 simulate.py matrix                # WR-tier x CB-tier sweep (slant vs man)
    python3 simulate.py batch 5000            # single matchup, summary stats
"""
import random
import sys
from dataclasses import dataclass, field
from typing import Optional


TIER_RANGES = {
    "elite":    (88, 95),
    "good":     (78, 87),
    "average":  (68, 77),
    "below":    (58, 67),
    "poor":     (45, 57),
}


def tier_roll(tier: str) -> int:
    lo, hi = TIER_RANGES[tier]
    return random.randint(lo, hi)


@dataclass
class Player:
    name: str
    ratings: dict = field(default_factory=dict)

    def r(self, key: str) -> int:
        return self.ratings.get(key, 0)


def slot_wr(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("SPD", "RTE", "CTH", "AWR", "BTK")})

def qb(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("ACC", "DEC", "ARM", "MOB", "AWR")})

def slot_cb(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("SPD", "COV", "ZON", "BSU", "AWR", "TKL")})

def mlb(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("COV", "ZON", "AWR", "TKL", "SPD", "STR", "BSU")})


# Throw quality bucket → catch bonus / break-up penalty
CATCH_BONUS = {"great": 30, "good": 15, "ok": 0, "low": -20, "bad": -40}
QUALITY_PENALTY = {"great": -20, "good": -10, "ok": 0, "low": 10, "bad": 25}

ROUTE_DEPTH = {"slant": 5, "hitch": 4, "out": 6}
YAC_BASE = {"slant": 2, "hitch": 1, "out": 2}        # hitch sits down → little YAC

# --- zone (Cover 3) tuning ---
# Separation the route earns vs a zone: the hitch settles in the void, the out
# breaks into the curl-flat defender.
ZONE_SEP_BONUS = {"slant": 6, "hitch": 22, "out": -10}
# Chance (base %) a zone dropper is sitting in the throwing lane for the route.
ZONE_LANE_BASE = {"slant": 28, "hitch": 6, "out": 42}


def d100() -> int:
    return random.randint(1, 100)

def check(target: int) -> bool:
    return d100() <= target

def check_margin(target: int) -> int:
    return target - d100()


def leverage_bonus(route: str, leverage: str) -> int:
    """Man coverage: break away from the defender's leverage to win separation."""
    if route == "hitch":
        return 0                                  # leverage-neutral
    if route == "slant":
        return 10 if leverage == "outside" else -10
    if route == "out":
        return 10 if leverage == "inside" else -10
    return 0


def _bucket_sep(margin: int) -> int:
    if margin >= 30:
        return 3
    if margin >= 10:
        return 2
    if margin >= -10:
        return 1
    return 0


def simulate_play(slot: Player, qb_p: Player, cb: Player, lb: Player,
                  route: str = "slant", coverage: str = "man",
                  leverage: str = "outside", trace: bool = False) -> dict:
    """Resolve one play. Mirror of the JS resolver. Returns dict outcome+chain."""
    events = ["[T0] snap"]
    events.append(f"[T1] {slot.name} runs the {route} ({coverage})")

    # T2 separation
    if coverage == "man":
        lev = leverage_bonus(route, leverage)
        spd_diff = (slot.r("SPD") - cb.r("SPD")) // 4
        rte_diff = (slot.r("RTE") - cb.r("COV")) // 2
        sep_target = 60 + lev + spd_diff + rte_diff
    else:  # zone (Cover 3)
        zb = ZONE_SEP_BONUS[route]
        # vs zone, beating a man matters less; finding the void matters more.
        rte_diff = (slot.r("RTE") - cb.r("ZON")) // 4
        sep_target = 56 + zb + rte_diff
    base_sep = _bucket_sep(check_margin(sep_target))
    events.append(f"[T2] separation {base_sep} hex")

    # T2 defender in the throwing lane
    if coverage == "man":
        uc_target = 3 + (lb.r("AWR") + lb.r("COV")) // 12
    else:  # zone droppers read the QB and sit in lanes for breaking routes
        uc_target = max(2, ZONE_LANE_BASE[route] + (lb.r("AWR") - 70) // 5)
    in_lane = check(uc_target)
    eff_window = max(0, base_sep - (1 if in_lane else 0))
    defender: Optional[Player] = lb if in_lane else (cb if base_sep == 0 else None)
    events.append(f"[T2] {'defender jumps the lane' if in_lane else 'lane clear'} (window {eff_window})")

    # T3 QB decision when there's no window
    if eff_window == 0:
        dec_target = 45 + qb_p.r("DEC") // 2
        if check(dec_target):
            events.append("[T3] QB checks it down — no window")
            return {"outcome": "incomplete", "yards": 0, "events": events}

    # T3 throw quality
    acc_target = 30 + qb_p.r("ACC") // 2 + eff_window * 8
    acc_margin = check_margin(acc_target)
    if acc_margin >= 40:    quality = "great"
    elif acc_margin >= 15:  quality = "good"
    elif acc_margin >= -10: quality = "ok"
    elif acc_margin >= -30: quality = "low"
    else:                   quality = "bad"
    events.append(f"[T3] throw quality={quality} window={eff_window}")

    # T4 defender plays the ball
    if defender is not None:
        bsu_target = 5 + defender.r("BSU") // 4 + QUALITY_PENALTY[quality]
        if check(bsu_target):
            int_chance = 10 + defender.r("BSU") // 5
            if check(int_chance):
                ret = max(0, d100() // 8)
                events.append(f"[T4] {defender.name} INTERCEPTS (+{ret} return)")
                return {"outcome": "interception", "yards": -ret, "events": events}
            events.append(f"[T4] {defender.name} breaks up the pass")
            return {"outcome": "pbu", "yards": 0, "events": events}

    # T4 catch
    contested = defender is not None
    catch_target = 35 + slot.r("CTH") // 2 + CATCH_BONUS[quality]
    if contested:
        catch_target -= defender.r("BSU") // 4
    if not check(catch_target):
        events.append(f"[T4] {slot.name} can't bring it in")
        return {"outcome": "incomplete", "yards": 0, "events": events}
    events.append(f"[T4] {slot.name} catches it{' (contested)' if contested else ''}")

    # T5 YAC
    yac_bonus = (slot.r("BTK") + slot.r("SPD") - lb.r("TKL") - lb.r("SPD")) // 10
    yac = max(0, YAC_BASE[route] + yac_bonus + d100() // 25)
    events.append(f"[T5] +{yac} YAC")
    return {"outcome": "completion", "yards": ROUTE_DEPTH[route] + yac, "events": events}


def summarize(label: str, results: list) -> None:
    n = len(results)
    cmp = sum(1 for r in results if r["outcome"] == "completion")
    pbu = sum(1 for r in results if r["outcome"] == "pbu")
    intc = sum(1 for r in results if r["outcome"] == "interception")
    total_yds = sum(r["yards"] for r in results if r["outcome"] == "completion")
    long = max((r["yards"] for r in results if r["outcome"] == "completion"), default=0)
    print(f"{label:<30s} cmp% {cmp/n*100:5.1f}  int% {intc/n*100:4.1f}  pbu% {pbu/n*100:4.1f}  "
          f"ypa {total_yds/n:5.2f}  long {long}")


def run_rps(runs: int = 4000) -> None:
    """Route x coverage win-rate grid for a typical matchup, to check the read."""
    random.seed(42)
    slot = slot_wr("WR", "good")
    qb_p = qb("QB", "good")
    cb = slot_cb("CB", "average")
    lb = mlb("LB", "good")
    routes = ["slant", "hitch", "out"]
    print(f"Route x coverage — {runs} plays each — WR good / QB good / CB avg / LB good")
    print("=" * 74)
    print("MAN (Cover 1):")
    for lev in ("outside", "inside"):
        for rt in routes:
            res = [simulate_play(slot, qb_p, cb, lb, rt, "man", lev) for _ in range(runs)]
            summarize(f"  {rt:<6s} vs {lev} leverage", res)
    print("ZONE (Cover 3):")
    for rt in routes:
        res = [simulate_play(slot, qb_p, cb, lb, rt, "zone") for _ in range(runs)]
        summarize(f"  {rt:<6s} vs zone", res)


def run_matrix(runs: int = 2000) -> None:
    """WR-tier x CB-tier sweep, slant vs man — reproduces the README table."""
    random.seed(42)
    tiers = ["elite", "good", "average", "below", "poor"]
    qb_p = qb("QB", "good")
    lb = mlb("LB", "good")
    print(f"Slant vs Cover 1 (man) — tier matrix — {runs} plays each")
    print("=" * 74)
    for wr_t in tiers:
        for cb_t in tiers:
            slot = slot_wr("WR", wr_t)
            cb = slot_cb("CB", cb_t)
            res = [simulate_play(slot, qb_p, cb, lb, "slant", "man", "outside")
                   for _ in range(runs)]
            summarize(f"WR {wr_t:<7s} vs CB {cb_t:<7s}", res)


def main():
    args = sys.argv[1:]
    if not args:
        random.seed()
        slot, qb_p = slot_wr("C. Reed", "elite"), qb("J. Vance", "elite")
        cb, lb = slot_cb("M. Diallo", "average"), mlb("F. Boone", "good")
        r = simulate_play(slot, qb_p, cb, lb, "slant", "man", "outside")
        print("Slant vs Cover 1 — single play")
        for e in r["events"]:
            print("  " + e)
        print(f"  Result: {r['outcome']} ({r['yards']} yards)")
        return
    if args[0] == "rps":
        run_rps(int(args[1]) if len(args) > 1 else 4000)
        return
    if args[0] == "matrix":
        run_matrix(int(args[1]) if len(args) > 1 else 2000)
        return
    if args[0] == "batch":
        runs = int(args[1]) if len(args) > 1 else 2000
        random.seed(42)
        slot, qb_p = slot_wr("C. Reed", "elite"), qb("J. Vance", "elite")
        cb, lb = slot_cb("M. Diallo", "average"), mlb("F. Boone", "good")
        res = [simulate_play(slot, qb_p, cb, lb, "slant", "man", "outside") for _ in range(runs)]
        summarize("elite WR+QB vs avg CB (slant/man)", res)
        return
    print(f"unknown mode: {args[0]}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
