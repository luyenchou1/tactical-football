#!/usr/bin/env python3
"""
Python mirror of SlantVsCover1.swift. Used to validate matchup math
without a Swift toolchain. Should produce equivalent distributions to
the Swift simulator.

Run:
    python3 simulate.py            # single play with trace
    python3 simulate.py batch 5000 # 5000-play batch summary
    python3 simulate.py matrix     # tier x tier sweep
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
    return Player(name, {k: tier_roll(tier) for k in ("SPD", "COV", "BSU", "AWR", "TKL")})

def mlb(name: str, tier: str) -> Player:
    return Player(name, {k: tier_roll(tier) for k in ("COV", "AWR", "TKL", "SPD", "STR", "BSU")})


# Throw quality bucket → catch bonus
CATCH_BONUS = {"great": 30, "good": 15, "ok": 0, "low": -20, "bad": -40}
QUALITY_PENALTY = {"great": -20, "good": -10, "ok": 0, "low": 10, "bad": 25}


def d100() -> int:
    return random.randint(1, 100)


def check(target: int) -> bool:
    return d100() <= target


def check_margin(target: int) -> int:
    return target - d100()


def simulate_play(slot: Player, qb_p: Player, cb: Player, lb: Player,
                  trace: bool = False) -> dict:
    """Returns dict with outcome and chain. Mirror of SlantVsCover1.simulate()."""
    events = ["[T0] snap"]

    # T1 stem
    events.append(f"[T1] {slot.name} stems to 3yd")

    # T2 separation. Base 60 so a generic matchup defaults to ~1 hex (a step
    # of separation), not 0. Slant attacks inside leverage → +10 bonus.
    leverage = 10
    spd_diff = (slot.r("SPD") - cb.r("SPD")) // 4
    rte_diff = (slot.r("RTE") - cb.r("COV")) // 2
    sep_target = 60 + leverage + spd_diff + rte_diff
    sep_margin = check_margin(sep_target)
    if sep_margin >= 30:
        base_sep = 3
    elif sep_margin >= 10:
        base_sep = 2
    elif sep_margin >= -10:
        base_sep = 1
    else:
        base_sep = 0
    events.append(f"[T2] {slot.name} breaks — separation {base_sep} hex")

    # T2 MLB undercut. Rare — NFL LBs jump the slant maybe 15-20% of the time.
    uc_target = 3 + (lb.r("AWR") + lb.r("COV")) // 12
    undercut = check(uc_target)
    events.append(f"[T2] {lb.name} {'undercuts' if undercut else 'stays underneath'}")
    eff_window = max(0, base_sep - (1 if undercut else 0))

    # T3 QB decision. Even average NFL QBs check down most of the time when
    # the window is closed. Force rate should be high only for poor QBs.
    if eff_window == 0:
        dec_target = 45 + qb_p.r("DEC") // 2
        if check(dec_target):
            events.append("[T3] QB checks down — no window")
            return {"outcome": "incomplete", "yards": 0, "events": events}

    # T3 throw
    acc_target = 30 + qb_p.r("ACC") // 2 + eff_window * 8
    acc_margin = check_margin(acc_target)
    if acc_margin >= 40:    quality = "great"
    elif acc_margin >= 15:  quality = "good"
    elif acc_margin >= -10: quality = "ok"
    elif acc_margin >= -30: quality = "low"
    else:                   quality = "bad"
    events.append(f"[T3] throw quality={quality} window={eff_window}")

    # T4 defender in window?
    defender: Optional[Player] = None
    if undercut:        defender = lb
    elif base_sep == 0: defender = cb

    if defender is not None:
        # Great throws are nearly impossible to break up; bad throws are easy.
        bsu_target = 5 + defender.r("BSU") // 4 + QUALITY_PENALTY[quality]
        if check(bsu_target):
            int_chance = 10 + defender.r("BSU") // 5
            if check(int_chance):
                ret = max(0, d100() // 8)
                events.append(f"[T4] {defender.name} INTERCEPTS (+{ret} return)")
                return {"outcome": "interception", "yards": -ret, "events": events}
            else:
                events.append(f"[T4] {defender.name} breaks up the pass")
                return {"outcome": "pbu", "yards": 0, "events": events}

    # T4 catch
    contested = defender is not None
    catch_target = 35 + slot.r("CTH") // 2 + CATCH_BONUS[quality]
    if contested:
        catch_target -= defender.r("BSU") // 4
    if not check(catch_target):
        events.append(f"[T4] {slot.name} drops it")
        return {"outcome": "incomplete", "yards": 0, "events": events}
    events.append(f"[T4] {slot.name} catches {'(contested)' if contested else ''}")

    # T5 YAC
    yac_bonus = (slot.r("BTK") + slot.r("SPD") - lb.r("TKL") - lb.r("SPD")) // 10
    yac_jitter = d100() // 25
    yac = max(0, 2 + yac_bonus + yac_jitter)
    events.append(f"[T5] +{yac} YAC, tackled by {lb.name}")
    return {"outcome": "completion", "yards": 5 + yac, "events": events}


def summarize(label: str, results: list) -> None:
    n = len(results)
    cmp = sum(1 for r in results if r["outcome"] == "completion")
    inc = sum(1 for r in results if r["outcome"] == "incomplete")
    pbu = sum(1 for r in results if r["outcome"] == "pbu")
    intc = sum(1 for r in results if r["outcome"] == "interception")
    total_yds = sum(r["yards"] for r in results if r["outcome"] == "completion")
    long = max((r["yards"] for r in results if r["outcome"] == "completion"), default=0)
    print(f"{label:<36s} cmp% {cmp/n*100:5.1f}  int% {intc/n*100:4.1f}  pbu% {pbu/n*100:4.1f}  "
          f"ypa {total_yds/n:5.2f}  long {long}")


def main():
    args = sys.argv[1:]
    if not args:
        # single play
        random.seed()
        slot = slot_wr("C. Kupp", "elite")
        qb_p = qb("J. Allen", "elite")
        cb = slot_cb("M. Davis", "average")
        lb = mlb("F. Warner", "good")
        result = simulate_play(slot, qb_p, cb, lb)
        print(f"Slant vs Cover 1 — single play")
        for e in result["events"]:
            print("  " + e)
        print(f"  Result: {result['outcome']} ({result['yards']} yards)")
        return

    if args[0] == "batch":
        runs = int(args[1]) if len(args) > 1 else 2000
        random.seed(42)
        slot = slot_wr("C. Kupp", "elite")
        qb_p = qb("J. Allen", "elite")
        cb = slot_cb("M. Davis", "average")
        lb = mlb("F. Warner", "good")
        results = [simulate_play(slot, qb_p, cb, lb) for _ in range(runs)]
        summarize("elite WR + elite QB vs avg CB", results)
        return

    if args[0] == "matrix":
        runs = 2000
        random.seed(42)
        tiers = ["elite", "good", "average", "below", "poor"]
        print(f"Slant vs Cover 1 — tier matrix — {runs} plays each")
        print("─" * 90)
        # Fix QB and LB at "good" so we isolate the WR vs CB axis
        qb_p = qb("QB", "good")
        lb = mlb("MLB", "good")
        for wr_t in tiers:
            for cb_t in tiers:
                slot = slot_wr("WR", wr_t)
                cb = slot_cb("CB", cb_t)
                results = [simulate_play(slot, qb_p, cb, lb) for _ in range(runs)]
                summarize(f"WR {wr_t:<7s} vs CB {cb_t:<7s}", results)
        return

    print(f"unknown mode: {args[0]}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
