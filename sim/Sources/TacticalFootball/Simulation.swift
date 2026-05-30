import Foundation

/// Seedable PRNG so plays can be replayed deterministically when debugging.
/// xorshift64 — fine for game RNG, NOT for cryptography.
struct SeededRNG: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        // Avoid the all-zero state which xorshift can't escape.
        self.state = seed == 0 ? 0xDEAD_BEEF_CAFE_BABE : seed
    }

    mutating func next() -> UInt64 {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return state
    }
}

/// All RNG flows through one of these so tests stay reproducible. Reference
/// type so state propagates across the simulation calls without inout plumbing.
final class Dice {
    private var rng: SeededRNG

    init(seed: UInt64) {
        self.rng = SeededRNG(seed: seed)
    }

    /// 1–100 uniform.
    func d100() -> Int {
        Int.random(in: 1...100, using: &rng)
    }

    /// Returns true if a d100 roll comes in at or under `target`.
    func check(target: Int) -> Bool {
        d100() <= target
    }

    /// Returns the margin by which the roll passed (positive) or failed
    /// (negative). Useful when you want to grade an outcome rather than
    /// just pass/fail.
    func checkMargin(target: Int) -> Int {
        target - d100()
    }
}

/// Discrete throw-quality bucket produced by the QB's accuracy roll.
enum ThrowQuality: Int {
    case great = 4   // pinpoint, hits the receiver in stride
    case good = 3    // catchable, slight adjustment
    case ok = 2      // catchable but contested
    case low = 1     // poor placement, drops likely
    case bad = 0     // off-target, INT territory if defender present

    var description: String {
        switch self {
        case .great: return "great"
        case .good:  return "good"
        case .ok:    return "ok"
        case .low:   return "low"
        case .bad:   return "bad"
        }
    }

    /// Bonus applied to the receiver's catch check.
    var catchBonus: Int {
        switch self {
        case .great: return 30
        case .good:  return 15
        case .ok:    return 0
        case .low:   return -20
        case .bad:   return -40
        }
    }
}

/// What happened on the play. Surfaces every roll so the post-play breakdown
/// screen can render the chain.
struct PlayResult {
    enum Outcome {
        case completion(yards: Int)
        case incomplete
        case passBreakup
        case interception(returnYards: Int)
        case sack(yardsLost: Int)
    }

    let outcome: Outcome
    let ticks: [TickEvent]

    /// Compact human-readable summary line ("✓ Completion +8 yards").
    var summary: String {
        switch outcome {
        case .completion(let yards): return "✓ Completion +\(yards) yards"
        case .incomplete:            return "✗ Incomplete"
        case .passBreakup:           return "✗ PBU"
        case .interception(let r):   return "⚠ INTERCEPTION (returned \(r))"
        case .sack(let l):           return "✗ Sack -\(l)"
        }
    }
}

/// One slice of the play. The list of events forms the post-play breakdown.
enum TickEvent {
    case snap
    case routeStem(receiver: String, depth: Int)
    case routeBreak(receiver: String, separationHexes: Int, leverageNote: String)
    case undercut(defender: String, succeeded: Bool)
    case throwMade(quality: ThrowQuality, window: Int, targetReceiver: String)
    case noThrow(reason: String)
    case catchResolved(receiver: String, caught: Bool, contested: Bool)
    case interception(defender: String)
    case yacResolved(yards: Int, tackler: String)

    var line: String {
        switch self {
        case .snap:
            return "[T0] snap"
        case .routeStem(let r, let d):
            return "[T1] \(r) stems to \(d)yd"
        case .routeBreak(let r, let sep, let note):
            return "[T2] \(r) breaks — separation \(sep) hex (\(note))"
        case .undercut(let d, let ok):
            return "[T2] \(d) \(ok ? "READS slant, undercuts" : "stays in zone")"
        case .throwMade(let q, let w, let target):
            return "[T3] QB throws to \(target) — quality=\(q.description) window=\(w)"
        case .noThrow(let reason):
            return "[T3] QB checks down (\(reason))"
        case .catchResolved(let r, let ok, let contested):
            return "[T4] \(r) \(ok ? "CATCHES" : "drops")\(contested ? " (contested)" : "")"
        case .interception(let d):
            return "[T4] \(d) INTERCEPTS"
        case .yacResolved(let y, let t):
            return "[T5] gains \(y) YAC, tackled by \(t)"
        }
    }
}
