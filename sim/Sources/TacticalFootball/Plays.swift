import Foundation

enum LeverageDirection {
    case inside, outside, neutral
}

/// A receiver route. Depth is in yards; direction matters for slants/outs/corners.
enum Route {
    case slant(breakDepth: Int, direction: LeverageDirection)
    case go
    case hitch(depth: Int)
    case dig(depth: Int)
    case out(depth: Int)
    case post(depth: Int)
    case corner(depth: Int)
    case flat(direction: LeverageDirection)
    case streak  // alias for go, kept for readability
    case block
    case checkRelease

    /// Concept-level metadata for the playbook UI ("man-beater", "zone-beater").
    var concept: String {
        switch self {
        case .slant: return "rub / man-beater"
        case .hitch: return "zone-beater"
        case .out:   return "boundary route"
        case .corner: return "two-high beater"
        case .post:  return "single-high beater"
        case .go, .streak: return "vertical / clear"
        default: return "support"
        }
    }
}

/// Coverage scheme the defense calls. v1 only resolves Cover 1 Man, but the
/// enum is here so the rest of the engine can route on it.
enum Coverage {
    case cover0Blitz       // 0 deep safeties, all-out blitz
    case cover1Man         // 1 deep safety, man underneath
    case cover2Zone        // 2 deep safeties, 5-under zone
    case cover3Zone        // 3 deep zones, 4-under
    case cover4Quarters    // 4 deep quarters
    case cover6            // quarter-quarter-half

    var displayName: String {
        switch self {
        case .cover0Blitz:    return "Cover 0 (Blitz)"
        case .cover1Man:      return "Cover 1 (Man)"
        case .cover2Zone:     return "Cover 2 Zone"
        case .cover3Zone:     return "Cover 3 Zone"
        case .cover4Quarters: return "Cover 4 (Quarters)"
        case .cover6:         return "Cover 6"
        }
    }

    /// Routes that historically beat this coverage. Surfaced to the
    /// teaching layer; not used by the resolution math directly.
    var weakAgainstConcepts: [String] {
        switch self {
        case .cover1Man:   return ["slant", "mesh", "switch verticals", "shallow cross"]
        case .cover0Blitz: return ["slant", "quick out", "fade"]
        case .cover2Zone:  return ["smash", "seam", "four verticals"]
        case .cover3Zone:  return ["smash", "Y-stick", "curl-flat"]
        case .cover4Quarters: return ["Hi-Lo crosser", "stick-nod"]
        case .cover6:      return ["smash to field", "verticals to boundary"]
        }
    }
}

/// An offensive play call: formation + per-position route assignments.
struct OffensivePlay {
    let name: String
    let formation: String
    let conceptTags: [String]
    /// Map a role label ("slot", "outside", "RB") to the route they run.
    let routes: [String: Route]
}
