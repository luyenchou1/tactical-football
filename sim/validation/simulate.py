#!/usr/bin/env python3
"""
Python mirror of the Tactical Football matchup math. Stdlib only — no deps.
Validates the distributions the JS engine (web/sim.js) reproduces.

It resolves ONE targeted receiver running ONE route against one defender + an
underneath linebacker, under one of two coverages:

  man   — Cover 1: the defender plays man with a leverage (inside/outside).
          Break-routes win by breaking AWAY from the defender's leverage.
  zone  — Cover 3: defenders play areas. Sit-down routes (hitch/curl) settle in
          the soft spot; breaking-out routes run into the curl-flat defender.

Routes live in a single data table (ROUTES) so adding one is just a row.

Run:
    python3 simulate.py                  # one slant vs man, verbose
    python3 simulate.py rps               # every route × coverage win-rate grid
    python3 simulate.py matrix            # WR-tier × CB-tier sweep (slant vs man)
    python3 simulate.py batch 5000        # one matchup, summary
"""
import random
import sys
from dataclasses import dataclass, field
from typing import Optional


TIER_RANGES = {
    "elite": (88, 95), "good": (78, 87), "average": (68, 77),
    "below": (58, 67), "poor": (45, 57),
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


def receiver(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("SPD", "RTE", "CTH", "AWR", "BTK")})

def qb(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("ACC", "DEC", "ARM", "MOB", "AWR")})

def defender(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("SPD", "COV", "ZON", "BSU", "AWR", "TKL")})

def linebacker(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("COV", "ZON", "AWR", "TKL", "SPD", "BSU")})


# Route table. Adding a route is one row.
#   depth     — yards downfield the catch happens
#   break     — 'in' | 'out' | None: which way it breaks (man leverage interaction)
#   man_base  — flat separation bonus vs man (scheme / rub / pick)
#   zone_sep  — separation bonus vs zone (finding the void)
#   zone_lane — base % a zone dropper sits in the throwing lane
#   yac       — base yards after catch
ROUTES = {
    "slant": {"depth": 5,  "break": "in",  "man_base": 0,  "zone_sep": 6,   "zone_lane": 28, "yac": 2},
    "hitch": {"depth": 5,  "break": None,  "man_base": 0,  "zone_sep": 22,  "zone_lane": 6,  "yac": 1},
    "out":   {"depth": 6,  "break": "out", "man_base": 0,  "zone_sep": -10, "zone_lane": 42, "yac": 2},
    "drag":  {"depth": 4,  "break": None,  "man_base": 12, "zone_sep": 10,  "zone_lane": 18, "yac": 4},
    "dig":   {"depth": 11, "break": "in",  "man_base": -4, "zone_sep": 8,   "zone_lane": 32, "yac": 2},
    "curl":  {"depth": 9,  "break": None,  "man_base": 2,  "zone_sep": 18,  "zone_lane": 12, "yac": 1},
    "flat":  {"depth": 2,  "break": None,  "man_base": 10, "zone_sep": 16,  "zone_lane": 8,  "yac": 3},
}

CATCH_BONUS = {"great": 30, "good": 15, "ok": 0, "low": -20, "bad": -40}
QUALITY_PENALTY = {"great": -20, "good": -10, "ok": 0, "low": 10, "bad": 25}


def d100() -> int:
    return random.randint(1, 100)

def check(target: int) -> bool:
    return d100() <= target

def check_margin(target: int) -> int:
    return target - d100()


def lev_term(brk: Optional[str], leverage: str) -> int:
    if brk is None:
        return 0
    if brk == "in":
        return 10 if leverage == "outside" else -10
    return 10 if leverage == "inside" else -10   # 'out'


def _bucket_sep(margin: int) -> int:
    if margin >= 30: return 3
    if margin >= 10: return 2
    if margin >= -10: return 1
    return 0


def resolve(rec: Player, qb_p: Player, defn: Player, lb: Player,
            route: str = "slant", coverage: str = "man",
            leverage: str = "outside") -> dict:
    """Resolve the targeted receiver's route. Mirror of JS resolvePlay()."""
    rt = ROUTES[route]
    depth_pen = max(0, (rt["depth"] - 5)) // 2     # deeper throws are a touch harder

    # T2 separation
    if coverage == "man":
        spd_diff = (rec.r("SPD") - defn.r("SPD")) // 4
        rte_diff = (rec.r("RTE") - defn.r("COV")) // 2
        sep_target = 60 + rt["man_base"] + lev_term(rt["break"], leverage) + spd_diff + rte_diff
    else:
        rte_diff = (rec.r("RTE") - defn.r("ZON")) // 4
        sep_target = 56 + rt["zone_sep"] + rte_diff
    base_sep = _bucket_sep(check_margin(sep_target))

    # T2 defender in the throwing lane
    if coverage == "man":
        uc_target = 3 + (lb.r("AWR") + lb.r("COV")) // 12
    else:
        uc_target = max(2, rt["zone_lane"] + (lb.r("AWR") - 70) // 5)
    in_lane = check(uc_target)
    eff_window = max(0, base_sep - (1 if in_lane else 0))
    defender_in_window = lb if in_lane else (defn if base_sep == 0 else None)

    # T3 QB decision when there's no window
    if eff_window == 0 and check(45 + qb_p.r("DEC") // 2):
        return {"outcome": "incomplete", "yards": 0}

    # T3 throw quality
    acc_target = 30 + qb_p.r("ACC") // 2 + eff_window * 8 - depth_pen
    m = check_margin(acc_target)
    quality = ("great" if m >= 40 else "good" if m >= 15 else "ok"
               if m >= -10 else "low" if m >= -30 else "bad")

    # T4 defender plays the ball
    if defender_in_window is not None:
        bsu_target = 5 + defender_in_window.r("BSU") // 4 + QUALITY_PENALTY[quality]
        if check(bsu_target):
            if check(10 + defender_in_window.r("BSU") // 5):
                return {"outcome": "interception", "yards": -max(0, d100() // 8)}
            return {"outcome": "pbu", "yards": 0}

    # T4 catch
    contested = defender_in_window is not None
    catch_target = 35 + rec.r("CTH") // 2 + CATCH_BONUS[quality]
    if contested:
        catch_target -= defender_in_window.r("BSU") // 4
    if not check(catch_target):
        return {"outcome": "incomplete", "yards": 0}

    # T5 YAC
    yac = max(0, rt["yac"] + (rec.r("BTK") + rec.r("SPD") - lb.r("TKL") - lb.r("SPD")) // 10 + d100() // 25)
    return {"outcome": "completion", "yards": rt["depth"] + yac}


def summarize(label: str, results: list) -> None:
    n = len(results)
    cmp = sum(1 for r in results if r["outcome"] == "completion")
    intc = sum(1 for r in results if r["outcome"] == "interception")
    pbu = sum(1 for r in results if r["outcome"] == "pbu")
    yds = sum(r["yards"] for r in results if r["outcome"] == "completion")
    long = max((r["yards"] for r in results if r["outcome"] == "completion"), default=0)
    print(f"{label:<26s} cmp% {cmp/n*100:5.1f}  int% {intc/n*100:4.1f}  pbu% {pbu/n*100:4.1f}  "
          f"ypa {yds/n:5.2f}  long {long}")


def run_rps(runs: int = 4000) -> None:
    random.seed(42)
    rec = receiver("WR", "good"); qb_p = qb("QB", "good")
    defn = defender("CB", "average"); lb = linebacker("LB", "good")
    print(f"Route × coverage — {runs} plays each — WR good / QB good / CB avg / LB good")
    print("=" * 78)
    for route, rt in ROUTES.items():
        brk = rt["break"]
        good_lev = "outside" if brk == "in" else "inside"
        bad_lev = "inside" if brk == "in" else "outside"
        if brk:
            res = [resolve(rec, qb_p, defn, lb, route, "man", good_lev) for _ in range(runs)]
            summarize(f"{route:<6s} man (beat lev)", res)
            res = [resolve(rec, qb_p, defn, lb, route, "man", bad_lev) for _ in range(runs)]
            summarize(f"{route:<6s} man (into lev)", res)
        else:
            res = [resolve(rec, qb_p, defn, lb, route, "man", "outside") for _ in range(runs)]
            summarize(f"{route:<6s} man (neutral)", res)
        res = [resolve(rec, qb_p, defn, lb, route, "zone") for _ in range(runs)]
        summarize(f"{route:<6s} zone (Cover 3)", res)
        print("-" * 78)


def run_matrix(runs: int = 2000) -> None:
    random.seed(42)
    tiers = ["elite", "good", "average", "below", "poor"]
    qb_p = qb("QB", "good"); lb = linebacker("LB", "good")
    print(f"Slant vs Cover 1 (man) — tier matrix — {runs} plays each")
    print("=" * 78)
    for wr_t in tiers:
        for cb_t in tiers:
            rec = receiver("WR", wr_t); defn = defender("CB", cb_t)
            res = [resolve(rec, qb_p, defn, lb, "slant", "man", "outside") for _ in range(runs)]
            summarize(f"WR {wr_t:<7s} vs CB {cb_t:<7s}", res)


def main():
    args = sys.argv[1:]
    if not args:
        random.seed()
        rec = receiver("C. Reed", "elite"); qb_p = qb("J. Vance", "elite")
        defn = defender("M. Diallo", "average"); lb = linebacker("F. Boone", "good")
        print("Slant vs Cover 1:", resolve(rec, qb_p, defn, lb, "slant", "man", "outside"))
        return
    if args[0] == "rps":
        run_rps(int(args[1]) if len(args) > 1 else 4000); return
    if args[0] == "matrix":
        run_matrix(int(args[1]) if len(args) > 1 else 2000); return
    if args[0] == "batch":
        runs = int(args[1]) if len(args) > 1 else 2000
        random.seed(42)
        rec = receiver("WR", "elite"); qb_p = qb("QB", "elite")
        defn = defender("CB", "average"); lb = linebacker("LB", "good")
        summarize("elite WR vs avg CB (slant/man)",
                  [resolve(rec, qb_p, defn, lb, "slant", "man", "outside") for _ in range(runs)])
        return
    print(f"unknown mode: {args[0]}", file=sys.stderr); sys.exit(1)


if __name__ == "__main__":
    main()
