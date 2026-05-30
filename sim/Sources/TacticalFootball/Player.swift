import Foundation

enum Side {
    case offense, defense
}

enum Position: String {
    case QB, RB, FB, WR, TE
    case LT, LG, C, RG, RT
    case LE, DT, RE
    case OLB, MLB
    case CB, NB, SS, FS

    var side: Side {
        switch self {
        case .QB, .RB, .FB, .WR, .TE, .LT, .LG, .C, .RG, .RT:
            return .offense
        default:
            return .defense
        }
    }
}

/// All the rating axes the engine knows about. Each player only populates the
/// subset that's meaningful for their position; the rest read as 0 (which the
/// resolution math treats as "not applicable").
enum Rating: String, CaseIterable {
    // Universal
    case SPD, STR, AWR, STA, AGI

    // QB
    case ACC  // short/medium accuracy (we'll split into ACC_S, ACC_M, ACC_D later)
    case DEC  // decision making
    case ARM  // arm strength
    case MOB  // mobility

    // Skill (WR / TE / RB)
    case RTE  // route running
    case CTH  // catching
    case BTK  // break tackle

    // OL
    case PBK  // pass block
    case RBK  // run block

    // Coverage
    case COV  // man coverage
    case ZON  // zone coverage
    case BSU  // ball skills (PBU / INT)
    case TKL  // tackle

    // Pass rush / run D
    case PRS  // pass rush
    case RDF  // run defense
}

/// Coarse skill bucket used to author demo players quickly. Each tier maps to a
/// rating range that the demo factories sample inside.
enum Tier {
    case elite     // 88-95
    case good      // 78-87
    case average   // 68-77
    case belowAvg  // 58-67
    case poor      // 45-57

    var baseRating: ClosedRange<Int> {
        switch self {
        case .elite:    return 88...95
        case .good:     return 78...87
        case .average:  return 68...77
        case .belowAvg: return 58...67
        case .poor:     return 45...57
        }
    }
}

struct Player {
    let id: UUID
    let name: String
    let jerseyNumber: Int
    let position: Position
    private let ratings: [Rating: Int]

    init(name: String, jerseyNumber: Int, position: Position, ratings: [Rating: Int]) {
        self.id = UUID()
        self.name = name
        self.jerseyNumber = jerseyNumber
        self.position = position
        self.ratings = ratings
    }

    func rating(_ key: Rating) -> Int {
        ratings[key] ?? 0
    }

    /// Mean of all rated axes — the "overall" you'd show on the player card.
    var overall: Int {
        let active = ratings.values
        guard !active.isEmpty else { return 0 }
        return active.reduce(0, +) / active.count
    }

    /// 1–5 stars derived from overall. Matches Hoop League / Retro Bowl convention.
    var stars: Int {
        switch overall {
        case 90...: return 5
        case 80..<90: return 4
        case 70..<80: return 3
        case 60..<70: return 2
        default: return 1
        }
    }
}
