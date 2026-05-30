import Foundation

/// Headless simulator for ONE play: a quick slant by the slot receiver, with
/// Cover 1 Man behind it (single high safety, slot CB in man with outside
/// leverage, MLB underneath who may undercut the throwing window).
///
/// Resolution chain — every tick produces a `TickEvent` so the post-play
/// breakdown screen has a chain to render:
///
///   T0 snap
///   T1 stem (no rolls — slot WR releases, CB mirrors)
///   T2 break → separation roll (WR.RTE vs CB.COV + leverage + SPD diff)
///              + MLB undercut roll (binary, can close the window by 1 hex)
///   T3 QB decision → throw quality roll (QB.ACC vs window difficulty)
///   T4 catch → defender BSU roll first if in window, then WR.CTH check
///   T5 YAC if caught (WR.BTK + WR.SPD vs MLB.TKL + MLB.SPD)
///
/// Numbers come from the design notes; tune via the validation harness.
struct SlantVsCover1 {

    // Roles. Only these five players participate in the matchup chain.
    // The rest of the field (other 17 players) hold defaults — those
    // assignments will surface in the visual layer but don't affect this play.
    let slot: Player        // slot WR running the slant
    let qb: Player          // throws it
    let slotCB: Player      // slot CB in man with outside leverage
    let mlb: Player         // may undercut the throwing window
    let fs: Player          // single high safety (committed deep, not rolled)

    func simulate(dice: Dice) -> PlayResult {
        var events: [TickEvent] = [.snap]

        // T1 — stem. Slot WR releases inside on the 5-yard slant.
        events.append(.routeStem(receiver: slot.name, depth: 3))

        // T2 — break + separation. Base 60 so a generic matchup defaults to
        // ~1 hex of separation, not 0. Slant breaks INTO the CB's leverage.
        let leverageBonus = 10
        let speedDiff = (slot.rating(.SPD) - slotCB.rating(.SPD)) / 4
        let routeDiff = (slot.rating(.RTE) - slotCB.rating(.COV)) / 2
        let sepTarget = 60 + leverageBonus + speedDiff + routeDiff
        let sepMargin = dice.checkMargin(target: sepTarget)

        let baseSeparation: Int
        if sepMargin >= 30      { baseSeparation = 3 }
        else if sepMargin >= 10 { baseSeparation = 2 }
        else if sepMargin >= -10 { baseSeparation = 1 }
        else                    { baseSeparation = 0 }
        let leverageNote = "CB outside leverage, slant attacks inside"
        events.append(.routeBreak(receiver: slot.name,
                                  separationHexes: baseSeparation,
                                  leverageNote: leverageNote))

        // T2 — MLB undercut. Rare event — NFL LBs jump the slant
        // maybe 15–20% of the time, even when they read it correctly.
        let undercutTarget = 3 + (mlb.rating(.AWR) + mlb.rating(.COV)) / 12
        let undercutSuccess = dice.check(target: undercutTarget)
        events.append(.undercut(defender: mlb.name, succeeded: undercutSuccess))
        let effectiveWindow = max(0, baseSeparation - (undercutSuccess ? 1 : 0))

        // T3 — QB decision. Even average NFL QBs check down most of the
        // time when the window is closed. Only poor decision-makers force it.
        if effectiveWindow == 0 {
            let decisionTarget = 45 + qb.rating(.DEC) / 2
            if dice.check(target: decisionTarget) {
                events.append(.noThrow(reason: "no window, checked down"))
                return PlayResult(outcome: .incomplete, ticks: events)
            }
            // else falls through — QB forces it
        }

        // T3 — throw quality.
        let accTarget = 30 + qb.rating(.ACC) / 2 + effectiveWindow * 8
        let accMargin = dice.checkMargin(target: accTarget)
        let quality: ThrowQuality
        if accMargin >= 40       { quality = .great }
        else if accMargin >= 15  { quality = .good }
        else if accMargin >= -10 { quality = .ok }
        else if accMargin >= -30 { quality = .low }
        else                     { quality = .bad }
        events.append(.throwMade(quality: quality,
                                 window: effectiveWindow,
                                 targetReceiver: slot.name))

        // T4 — defender break-up chance, if anyone is in the window.
        // Order of operations: defender attempts to play the ball BEFORE the receiver.
        let defenderInWindow: Player? = {
            if undercutSuccess { return mlb }       // MLB sat in the throwing lane
            if baseSeparation == 0 { return slotCB } // CB stayed glued to the hip
            return nil
        }()

        if let defender = defenderInWindow {
            // Great throws are nearly impossible to break up; bad throws are easy.
            let qualityPenalty: Int = {
                switch quality {
                case .great: return -20
                case .good:  return -10
                case .ok:    return 0
                case .low:   return 10
                case .bad:   return 25
                }
            }()
            let bsuTarget = 5 + defender.rating(.BSU) / 4 + qualityPenalty
            if dice.check(target: bsuTarget) {
                // Defender plays the ball. INT vs PBU sub-roll.
                let intChance = 10 + defender.rating(.BSU) / 5
                if dice.check(target: intChance) {
                    events.append(.interception(defender: defender.name))
                    // Return yardage — quick estimate. 0–15 typical for slot INTs.
                    let ret = max(0, dice.d100() / 8)
                    return PlayResult(outcome: .interception(returnYards: ret),
                                      ticks: events)
                } else {
                    events.append(.catchResolved(receiver: slot.name,
                                                 caught: false,
                                                 contested: true))
                    return PlayResult(outcome: .passBreakup, ticks: events)
                }
            }
        }

        // T4 — receiver catch.
        let contested = (defenderInWindow != nil)
        let catchTarget = 35 + slot.rating(.CTH) / 2 + quality.catchBonus
            - (contested ? (defenderInWindow!.rating(.BSU) / 4) : 0)
        if !dice.check(target: catchTarget) {
            events.append(.catchResolved(receiver: slot.name,
                                         caught: false,
                                         contested: contested))
            return PlayResult(outcome: .incomplete, ticks: events)
        }
        events.append(.catchResolved(receiver: slot.name,
                                     caught: true,
                                     contested: contested))

        // T5 — YAC. Ball was caught at ~5 yards downfield.
        let yacBase = 2
        let yacBonus = (slot.rating(.BTK) + slot.rating(.SPD) - mlb.rating(.TKL) - mlb.rating(.SPD)) / 10
        let yacJitter = dice.d100() / 25  // 0–4 yards
        let yac = max(0, yacBase + yacBonus + yacJitter)
        events.append(.yacResolved(yards: yac, tackler: mlb.name))

        let totalYards = 5 + yac
        return PlayResult(outcome: .completion(yards: totalYards), ticks: events)
    }
}
