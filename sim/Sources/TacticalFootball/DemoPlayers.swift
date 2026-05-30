import Foundation

/// Factory functions for building rosters quickly during prototyping. Each
/// `make…(tier:)` produces a position-appropriate player with ratings
/// sampled from that tier's range. Names are placeholders.
extension Player {

    private static func roll(_ tier: Tier) -> Int {
        Int.random(in: tier.baseRating)
    }

    static func slotWR(name: String, number: Int = 11, tier: Tier) -> Player {
        Player(name: name, jerseyNumber: number, position: .WR, ratings: [
            .SPD: roll(tier),
            .RTE: roll(tier),
            .CTH: roll(tier),
            .AWR: roll(tier),
            .BTK: roll(tier),
            .STA: 80,
        ])
    }

    static func qb(name: String, number: Int = 9, tier: Tier) -> Player {
        Player(name: name, jerseyNumber: number, position: .QB, ratings: [
            .ACC: roll(tier),
            .DEC: roll(tier),
            .ARM: roll(tier),
            .MOB: roll(tier),
            .AWR: roll(tier),
            .STA: 85,
        ])
    }

    static func slotCB(name: String, number: Int = 27, tier: Tier) -> Player {
        Player(name: name, jerseyNumber: number, position: .NB, ratings: [
            .SPD: roll(tier),
            .COV: roll(tier),
            .BSU: roll(tier),
            .AWR: roll(tier),
            .TKL: roll(tier),
            .STA: 80,
        ])
    }

    static func mlb(name: String, number: Int = 54, tier: Tier) -> Player {
        Player(name: name, jerseyNumber: number, position: .MLB, ratings: [
            .COV: roll(tier),
            .AWR: roll(tier),
            .TKL: roll(tier),
            .SPD: roll(tier),
            .BSU: roll(tier),
            .STA: 85,
        ])
    }

    static func freeSafety(name: String, number: Int = 31, tier: Tier) -> Player {
        Player(name: name, jerseyNumber: number, position: .FS, ratings: [
            .SPD: roll(tier),
            .ZON: roll(tier),
            .BSU: roll(tier),
            .AWR: roll(tier),
            .TKL: roll(tier),
            .STA: 80,
        ])
    }
}
