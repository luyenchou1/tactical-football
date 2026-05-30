import Foundation

// MARK: - CLI args

enum Mode {
    case singlePlay
    case batch(runs: Int)
    case tierMatrix
}

func parseMode(_ args: [String]) -> Mode {
    if args.contains("--matrix") { return .tierMatrix }
    if let i = args.firstIndex(of: "--batch"),
       i + 1 < args.count,
       let n = Int(args[i + 1]) {
        return .batch(runs: n)
    }
    return .singlePlay
}

func parseSeed(_ args: [String]) -> UInt64 {
    if let i = args.firstIndex(of: "--seed"),
       i + 1 < args.count,
       let s = UInt64(args[i + 1]) {
        return s
    }
    return UInt64.random(in: 1...UInt64.max)
}

// MARK: - Demo runner

func runSinglePlay(seed: UInt64) {
    let dice = Dice(seed: seed)

    let slot = Player.slotWR(name: "C. Kupp",  tier: .elite)
    let qb = Player.qb(name: "J. Allen", tier: .elite)
    let cb = Player.slotCB(name: "M. Davis", tier: .average)
    let mlb = Player.mlb(name: "F. Warner", tier: .good)
    let fs  = Player.freeSafety(name: "D. James", tier: .good)

    print("┌─ Slant vs Cover 1 ─ seed \(seed) ─────────────────")
    print("│ Offense: \(qb.name) (QB ★\(qb.stars))  →  \(slot.name) (slot WR ★\(slot.stars))")
    print("│ Defense: \(cb.name) (slot CB ★\(cb.stars)), \(mlb.name) (MLB ★\(mlb.stars))")
    print("├──────────────────────────────────────────────────")

    let sim = SlantVsCover1(slot: slot, qb: qb, slotCB: cb, mlb: mlb, fs: fs)
    let result = sim.simulate(dice: dice)

    for event in result.ticks {
        print("│ " + event.line)
    }
    print("├──────────────────────────────────────────────────")
    print("│ Result: \(result.summary)")
    print("└──────────────────────────────────────────────────")
}

struct BatchStats {
    var completions = 0
    var incompletes = 0
    var pbus = 0
    var interceptions = 0
    var totalYards = 0
    var maxYards = 0
    var runs = 0

    mutating func record(_ result: PlayResult) {
        runs += 1
        switch result.outcome {
        case .completion(let y):
            completions += 1
            totalYards += y
            maxYards = max(maxYards, y)
        case .incomplete:        incompletes += 1
        case .passBreakup:       pbus += 1
        case .interception:      interceptions += 1
        case .sack(let l):       totalYards -= l
        }
    }

    func report(label: String) {
        let cmpPct = Double(completions) / Double(runs) * 100
        let intPct = Double(interceptions) / Double(runs) * 100
        let pbuPct = Double(pbus) / Double(runs) * 100
        let yps = Double(totalYards) / Double(runs)  // yards per snap
        let paddedLabel = label.padding(toLength: 36, withPad: " ", startingAt: 0)
        let cmpStr = String(format: "%5.1f", cmpPct)
        let intStr = String(format: "%4.1f", intPct)
        let pbuStr = String(format: "%4.1f", pbuPct)
        let ypsStr = String(format: "%5.2f", yps)
        print("\(paddedLabel) cmp% \(cmpStr)  int% \(intStr)  pbu% \(pbuStr)  ypa \(ypsStr)  long \(maxYards)")
    }
}

func runBatch(seed: UInt64, runs: Int) {
    let dice = Dice(seed: seed)
    let slot = Player.slotWR(name: "C. Kupp", tier: .elite)
    let qb = Player.qb(name: "J. Allen", tier: .elite)
    let cb = Player.slotCB(name: "M. Davis", tier: .average)
    let mlb = Player.mlb(name: "F. Warner", tier: .good)
    let fs = Player.freeSafety(name: "D. James", tier: .good)
    let sim = SlantVsCover1(slot: slot, qb: qb, slotCB: cb, mlb: mlb, fs: fs)

    var stats = BatchStats()
    for _ in 0..<runs {
        stats.record(sim.simulate(dice: dice))
    }
    print("Slant vs Cover 1 — \(runs) plays — seed \(seed)")
    stats.report(label: "elite WR + elite QB vs avg CB")
}

/// Sweep player tiers to confirm rating spread translates to expected
/// completion-rate spread. Should produce a monotonic gradient.
func runTierMatrix(seed: UInt64) {
    let runs = 2000
    let dice = Dice(seed: seed)
    let qb = Player.qb(name: "QB", tier: .good)
    let mlb = Player.mlb(name: "MLB", tier: .good)
    let fs = Player.freeSafety(name: "FS", tier: .good)

    print("Slant vs Cover 1 — tier matrix — \(runs) plays each — seed \(seed)")
    print(String(repeating: "─", count: 80))

    let tiers: [(String, Tier)] = [
        ("elite",    .elite),
        ("good",     .good),
        ("average",  .average),
        ("below",    .belowAvg),
        ("poor",     .poor),
    ]
    for (wrLabel, wrTier) in tiers {
        for (cbLabel, cbTier) in tiers {
            let slot = Player.slotWR(name: "WR", tier: wrTier)
            let cb = Player.slotCB(name: "CB", tier: cbTier)
            let sim = SlantVsCover1(slot: slot, qb: qb, slotCB: cb, mlb: mlb, fs: fs)
            var stats = BatchStats()
            for _ in 0..<runs {
                stats.record(sim.simulate(dice: dice))
            }
            stats.report(label: "WR \(wrLabel.padding(toLength: 7, withPad: " ", startingAt: 0)) vs CB \(cbLabel)")
        }
    }
}

// MARK: - Entry

let args = Array(CommandLine.arguments.dropFirst())
let mode = parseMode(args)
let seed = parseSeed(args)

switch mode {
case .singlePlay:   runSinglePlay(seed: seed)
case .batch(let n): runBatch(seed: seed, runs: n)
case .tierMatrix:   runTierMatrix(seed: seed)
}
