#!/usr/bin/env python3
"""
Python mirror of the Tactical Football matchup math (web/sim.js). Stdlib only.

Resolves ONE targeted receiver running ONE route against one defender + an
underneath linebacker, under man (Cover 1), zone (Cover 3), or blitz. The chain:
  read -> separation -> lane -> pass rush (sack/hurry) -> throw -> contest -> catch -> YAC

Risk lives in the pass rush (a deep route held too long is sacked/hurried) and
in forced throws into coverage (thrown more, thrown worse, picked more).

Run:
    python3 simulate.py                  # one slant vs man, verbose-ish
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


# Route table — adding a route is one row. tt = time-to-throw (seconds).
ROUTES = {
    "slant": {"depth": 5,  "break": "in",  "man_base": 0,  "zone_sep": 6,   "zone_lane": 28, "yac": 2, "tt": 1.4},
    "hitch": {"depth": 5,  "break": None,  "man_base": 0,  "zone_sep": 22,  "zone_lane": 6,  "yac": 1, "tt": 1.8},
    "out":   {"depth": 6,  "break": "out", "man_base": 0,  "zone_sep": -10, "zone_lane": 42, "yac": 2, "tt": 1.9},
    "drag":  {"depth": 4,  "break": None,  "man_base": 12, "zone_sep": 10,  "zone_lane": 18, "yac": 4, "tt": 1.5},
    "dig":   {"depth": 11, "break": "in",  "man_base": -4, "zone_sep": 8,   "zone_lane": 32, "yac": 2, "tt": 2.9},
    "curl":  {"depth": 9,  "break": None,  "man_base": 2,  "zone_sep": 18,  "zone_lane": 12, "yac": 1, "tt": 2.3},
    "flat":  {"depth": 2,  "break": None,  "man_base": 10, "zone_sep": 16,  "zone_lane": 8,  "yac": 3, "tt": 1.4},
    # deep shots — slow to develop (a sack gamble), pay off in chunk yards on a clean read;
    # forcing one into coverage is the riskiest throw in the game (INT scales with depth)
    "go":     {"depth": 17, "break": None,  "man_base": -9, "zone_sep": -5, "zone_lane": 10, "yac": 2, "tt": 3.8},
    "post":   {"depth": 16, "break": "in",  "man_base": -6, "zone_sep": 5,  "zone_lane": 18, "yac": 2, "tt": 3.4},
    "corner": {"depth": 16, "break": "out", "man_base": -3, "zone_sep": 4,  "zone_lane": 10, "yac": 1, "tt": 3.2},
    # screen — caught behind the LOS; resolves on coverage ALONE via the screen branch in resolve()
    # (man_base/zone_sep/zone_lane inert, yac cosmetic). Inverse of a deep shot: sack-proof + INT-proof,
    # a chunk vs the vacated blitz, a wasted down vs a disciplined front.
    "screen": {"depth": 1,  "break": None,  "man_base": 0,  "zone_sep": 0,   "zone_lane": 0,  "yac": 6, "tt": 1.1, "screen": True},
    # sail — deep out into the sideline void behind the flat defender (Flood's high-low in one vector):
    # beats zone, leverage-dependent vs man, tt-taxed vs blitz so it can't be mashed.
    "sail":   {"depth": 13, "break": "out", "man_base": -2, "zone_sep": 10,  "zone_lane": 40, "yac": 2, "tt": 3.0},
    # wheel — the RB up the sideline vs a linebacker: beats man (esp. inside leverage), dead vs zone.
    "wheel":  {"depth": 12, "break": "out", "man_base": 8,  "zone_sep": -4,  "zone_lane": 38, "yac": 3, "tt": 3.0},
}

CATCH_BONUS = {"great": 30, "good": 15, "ok": 0, "low": -20, "bad": -40}
QUALITY_PENALTY = {"great": -20, "good": -10, "ok": 0, "low": 10, "bad": 25}
# screen — coverage is the only axis (a bet on the blitz): connect% = completion, yac_base = blocking lead
SCREEN_CONNECT = {"blitz": 92, "zone": 70, "man": 58}
SCREEN_YAC = {"blitz": 7, "zone": 3, "man": 1}

PROTECT = {"base": 2.0, "blitz": 1.5}
SACK = {"base": 2, "blitz": 9, "perSec": 8}
HURRY = {"base": 6, "blitz": 15, "perSec": 16}


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
    depth_pen = max(0, rt["depth"] - 5) // 2
    is_blitz = coverage == "blitz"
    is_zone = coverage == "zone"

    # SCREEN — a bet on the blitz (mirror of JS resolvePlay screen branch): coverage is the only axis,
    # sack-proof + INT-proof, a chunk vs the vacated blitz, a wasted down vs a disciplined front.
    # EXACTLY 2 rolls (connect, then yac) in this order to stay aligned with the JS branch.
    if rt.get("screen"):
        cov = "blitz" if is_blitz else "zone" if is_zone else "man"
        conn_roll = d100()
        if conn_roll > SCREEN_CONNECT[cov]:
            return {"outcome": "incomplete", "yards": 0}
        screen_yac = max(0, SCREEN_YAC[cov]
                         + (rec.r("BTK") + rec.r("SPD") - lb.r("TKL") - lb.r("SPD")) // 10
                         + d100() // 25)
        return {"outcome": "completion", "yards": 1 + screen_yac}

    # separation + read
    if is_zone:
        rte_diff = (rec.r("RTE") - defn.r("ZON")) // 4
        sep_target = 56 + rt["zone_sep"] + rte_diff
        bad_read = rt["zone_sep"] < 0
    else:
        lev_b = lev_term(rt["break"], leverage)
        spd_diff = (rec.r("SPD") - defn.r("SPD")) // 4
        rte_diff = (rec.r("RTE") - defn.r("COV")) // 2
        vacated = 8 if is_blitz else 0
        sep_target = 60 + rt["man_base"] + lev_b + spd_diff + rte_diff + vacated
        bad_read = lev_b < 0
    base_sep = _bucket_sep(check_margin(sep_target))

    # defender in the throwing lane (none on a blitz — the robber is rushing)
    lane_target = 0
    if not is_blitz:
        lane_target = (max(2, rt["zone_lane"] + (lb.r("AWR") - 70) // 5) if is_zone
                       else 3 + (lb.r("AWR") + lb.r("COV")) // 12)
    in_lane = lane_target > 0 and check(lane_target)
    eff_window = max(0, base_sep - (1 if in_lane else 0))

    # pass rush / pocket clock
    protect = PROTECT["blitz"] if is_blitz else PROTECT["base"]
    excess = max(0.0, rt["tt"] - protect)
    mob_adj = max(0, (qb_p.r("MOB") - 72) // 3)
    sack_p = min(42, max(0, (SACK["blitz"] if is_blitz else SACK["base"]) + int(excess * SACK["perSec"]) - mob_adj))
    hurry_p = min(60, max(0, (HURRY["blitz"] if is_blitz else HURRY["base"]) + int(excess * HURRY["perSec"]) - mob_adj))
    p_roll = d100()
    hurried = False
    if p_roll <= sack_p:
        return {"outcome": "sack", "yards": -(4 + d100() // 20)}
    elif p_roll <= sack_p + hurry_p:
        hurried = True

    # QB decision when there's no window (a forced ball gets thrown, not checked down)
    if eff_window == 0:
        dec_t = 45 + qb_p.r("DEC") // 2
        if bad_read:
            dec_t -= 25
        if check(dec_t):
            return {"outcome": "incomplete", "yards": 0}

    # throw quality
    acc_t = 30 + qb_p.r("ACC") // 2 + eff_window * 8 - depth_pen
    if hurried:
        acc_t -= 14
    if eff_window == 0 and bad_read:
        acc_t -= 12 + max(0, rt["depth"] - 5)
    m = check_margin(acc_t)
    quality = ("great" if m >= 40 else "good" if m >= 15 else "ok"
               if m >= -10 else "low" if m >= -30 else "bad")

    # defender plays the ball (continuous INT risk: worse on forced + deep throws)
    defender = lb if in_lane else (defn if base_sep == 0 else None)
    if defender is not None:
        bsu_target = 5 + defender.r("BSU") // 4 + QUALITY_PENALTY[quality]
        if check(bsu_target):
            int_t = 10 + defender.r("BSU") // 5 + (8 if eff_window == 0 else 0) + max(0, rt["depth"] - 5) * 2
            if check(int_t):
                return {"outcome": "interception", "yards": 0}
            return {"outcome": "pbu", "yards": 0}

    # catch
    contested = defender is not None
    catch_target = 35 + rec.r("CTH") // 2 + CATCH_BONUS[quality]
    if contested:
        catch_target -= defender.r("BSU") // 4
    if not check(catch_target):
        return {"outcome": "incomplete", "yards": 0}

    # YAC
    yac = max(0, rt["yac"] + (rec.r("BTK") + rec.r("SPD") - lb.r("TKL") - lb.r("SPD")) // 10 + d100() // 25)
    return {"outcome": "completion", "yards": rt["depth"] + yac}


def summarize(label: str, results: list) -> None:
    n = len(results)
    cmp = sum(1 for r in results if r["outcome"] == "completion")
    intc = sum(1 for r in results if r["outcome"] == "interception")
    sack = sum(1 for r in results if r["outcome"] == "sack")
    yds = sum(r["yards"] for r in results if r["outcome"] == "completion")
    ev = sum(r["yards"] for r in results)              # expected value incl. sacks/INTs
    long = max((r["yards"] for r in results if r["outcome"] == "completion"), default=0)
    print(f"{label:<26s} cmp% {cmp/n*100:5.1f}  int% {intc/n*100:4.2f}  sack% {sack/n*100:4.1f}  "
          f"ypa {yds/n:5.2f}  EV {ev/n:5.2f}  long {long}")


def run_rps(runs: int = 4000) -> None:
    random.seed(42)
    rec = receiver("WR", "good"); qb_p = qb("QB", "good")
    defn = defender("CB", "average"); lb = linebacker("LB", "good")
    print(f"Route × coverage — {runs} plays each — WR good / QB good / CB avg / LB good")
    print("=" * 84)
    for route, rt in ROUTES.items():
        brk = rt["break"]
        good_lev = "outside" if brk == "in" else "inside"
        bad_lev = "inside" if brk == "in" else "outside"
        if brk:
            summarize(f"{route:<6s} man (beat lev)", [resolve(rec, qb_p, defn, lb, route, "man", good_lev) for _ in range(runs)])
            summarize(f"{route:<6s} man (into lev)", [resolve(rec, qb_p, defn, lb, route, "man", bad_lev) for _ in range(runs)])
        else:
            summarize(f"{route:<6s} man (neutral)", [resolve(rec, qb_p, defn, lb, route, "man", "outside") for _ in range(runs)])
        summarize(f"{route:<6s} zone (Cover 3)", [resolve(rec, qb_p, defn, lb, route, "zone") for _ in range(runs)])
        summarize(f"{route:<6s} blitz", [resolve(rec, qb_p, defn, lb, route, "blitz", "outside") for _ in range(runs)])
        print("-" * 84)


def run_matrix(runs: int = 2000) -> None:
    random.seed(42)
    tiers = ["elite", "good", "average", "below", "poor"]
    qb_p = qb("QB", "good"); lb = linebacker("LB", "good")
    print(f"Slant vs Cover 1 (man) — tier matrix — {runs} plays each")
    print("=" * 84)
    for wr_t in tiers:
        for cb_t in tiers:
            rec = receiver("WR", wr_t); defn = defender("CB", cb_t)
            summarize(f"WR {wr_t:<7s} vs CB {cb_t:<7s}",
                      [resolve(rec, qb_p, defn, lb, "slant", "man", "outside") for _ in range(runs)])


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
