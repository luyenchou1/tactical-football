// sim.js — pure game logic for Tactical Football. No DOM, so it runs in the
// browser and in Node (for tests). Direct port of validation/simulate.py.
//
// Resolves one slot-receiver route against one of two coverages:
//   man   — Cover 1: slot defender plays man with a leverage. Break AWAY from
//           his leverage (slant beats outside, out beats inside; hitch neutral).
//   zone  — Cover 3: defenders play areas. The hitch settles in the soft spot
//           (zone-beater), the slant works underneath, the out gets jumped by
//           the curl-flat defender.

(function (root) {
  'use strict';

  // ---------- dice ----------
  function d100() { return Math.floor(Math.random() * 100) + 1; }
  function trunc(n) { return Math.trunc(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  // ---------- default roster (ratings 45–95) ----------
  const DEFAULT_PLAYERS = {
    slot: { name: 'C. Reed',  num: 11, pos: 'WR',
            r: { SPD: 90, RTE: 88, CTH: 88, AWR: 85, BTK: 82, STA: 80 } },
    qb:   { name: 'J. Vance', num: 9,  pos: 'QB',
            r: { ACC: 90, DEC: 88, ARM: 85, MOB: 75, AWR: 88, STA: 85 } },
    nb:   { name: 'M. Diallo', num: 27, pos: 'NB',
            r: { SPD: 74, COV: 72, ZON: 72, BSU: 70, AWR: 72, TKL: 70, STA: 80 } },
    mlb:  { name: 'F. Boone', num: 54, pos: 'MLB',
            r: { COV: 80, ZON: 80, AWR: 82, TKL: 84, SPD: 80, BSU: 78, STA: 85 } },
    fs:   { name: 'D. Park',  num: 31, pos: 'FS',
            r: { SPD: 82, ZON: 80, BSU: 80, AWR: 82, TKL: 80, STA: 80 } },
  };

  // ---------- tuning constants (mirror simulate.py) ----------
  const ROUTE_DEPTH = { slant: 5, hitch: 4, out: 6 };
  const YAC_BASE = { slant: 2, hitch: 1, out: 2 };
  const ZONE_SEP_BONUS = { slant: 6, hitch: 22, out: -10 };
  const ZONE_LANE_BASE = { slant: 28, hitch: 6, out: 42 };
  const CATCH_BONUS = { great: 30, good: 15, ok: 0, low: -20, bad: -40 };
  const QUALITY_PENALTY = { great: -20, good: -10, ok: 0, low: 10, bad: 25 };

  // ---------- reads ----------
  function leverageBonus(route, leverage) {
    if (route === 'hitch') return 0;
    if (route === 'slant') return leverage === 'outside' ? 10 : -10;
    if (route === 'out')   return leverage === 'inside'  ? 10 : -10;
    return 0;
  }
  function routeDepth(route) { return ROUTE_DEPTH[route] || 5; }

  function bucketSep(margin) {
    return margin >= 30 ? 3 : margin >= 10 ? 2 : margin >= -10 ? 1 : 0;
  }

  // ---------- main resolver ----------
  // resolvePlay(route, coverage, leverage, players)
  //   route    ∈ 'slant' | 'hitch' | 'out'
  //   coverage ∈ 'man' | 'zone'
  //   leverage ∈ 'inside' | 'outside'   (only meaningful for man)
  // Returns { outcome, yards, chain:[steps], meta:{...} }.
  function resolvePlay(route, coverage, leverage, players) {
    const P = players || DEFAULT_PLAYERS;
    const slot = P.slot, qb = P.qb, nb = P.nb, mlb = P.mlb;
    const chain = [];
    const meta = { route: route, coverage: coverage, leverage: leverage,
                   undercut: false, sep: 0, window: 0, caught: false, intercepted: false };

    // 1 — separation (the read lives here)
    let sepTarget, sepRoll, sepMargin;
    if (coverage === 'man') {
      const lev = leverageBonus(route, leverage);
      const spdDiff = trunc((slot.r.SPD - nb.r.SPD) / 4);
      const rteDiff = trunc((slot.r.RTE - nb.r.COV) / 2);
      sepTarget = 60 + lev + spdDiff + rteDiff;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      chain.push({
        key: 'read', label: 'Coverage', value: 'Man · ' + cap(route) + ' vs ' + leverage,
        status: lev > 0 ? 'good' : lev < 0 ? 'bad' : 'neutral',
        detail: lev > 0 ? cap(route) + ' breaks away from ' + leverage + ' leverage (+10 sep)'
              : lev < 0 ? cap(route) + ' breaks into ' + leverage + ' leverage (−10 sep)'
              : 'Hitch is leverage-neutral — a safe answer',
        math: 'sep target = 60 ' + fmt(lev) + ' lev ' + fmt(spdDiff) + ' spd ' + fmt(rteDiff) +
              ' route = ' + sepTarget + '; rolled ' + sepRoll,
      });
    } else { // zone (Cover 3)
      const zb = ZONE_SEP_BONUS[route];
      const rteDiff = trunc((slot.r.RTE - nb.r.ZON) / 4);
      sepTarget = 56 + zb + rteDiff;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      chain.push({
        key: 'read', label: 'Coverage', value: 'Cover 3 · ' + cap(route),
        status: zb > 10 ? 'good' : zb >= 0 ? 'neutral' : 'bad',
        detail: route === 'hitch' ? 'Hitch settles in the soft spot vs zone (zone-beater)'
              : route === 'slant' ? 'Slant works underneath, but zone droppers read it'
              : 'The out breaks into the curl-flat defender',
        math: 'sep target = 56 ' + fmt(zb) + ' zone ' + fmt(rteDiff) + ' route = ' +
              sepTarget + '; rolled ' + sepRoll,
      });
    }
    const sep = bucketSep(sepMargin);
    meta.sep = sep;
    chain.push({
      key: 'separation', label: 'Separation', value: sep + ' yd',
      status: sep >= 2 ? 'good' : sep === 1 ? 'neutral' : 'bad',
      detail: sep >= 2 ? 'Receiver wins clean' : sep === 1 ? 'A step of room' : 'Blanketed',
      math: 'margin ' + sepMargin + ' → ' + sep + ' yd',
    });

    // 2 — defender in the throwing lane
    let laneTarget;
    if (coverage === 'man') {
      laneTarget = 3 + trunc((mlb.r.AWR + mlb.r.COV) / 12);
    } else {
      laneTarget = Math.max(2, ZONE_LANE_BASE[route] + trunc((mlb.r.AWR - 70) / 5));
    }
    const laneRoll = d100();
    const inLane = laneRoll <= laneTarget;
    meta.undercut = inLane;
    const windowSz = Math.max(0, sep - (inLane ? 1 : 0));
    meta.window = windowSz;
    chain.push({
      key: 'undercut',
      label: coverage === 'man' ? 'LB in the lane' : 'Zone dropper',
      status: inLane ? 'bad' : 'good',
      value: inLane ? 'jumps the lane' : 'stays home',
      detail: inLane ? mlb.name + ' sits in the throwing lane (window −1)'
                     : mlb.name + ' is out of the lane',
      math: 'lane chance ' + laneTarget + '%; rolled ' + laneRoll,
    });

    // 3 — QB decision when there's no window
    if (windowSz === 0) {
      const decT = 45 + trunc(qb.r.DEC / 2);
      const decRoll = d100();
      if (decRoll <= decT) {
        chain.push({
          key: 'decision', label: 'QB read', status: 'neutral', value: 'check down',
          detail: qb.name + ' sees no window and checks it down',
          math: 'recognise ' + decT + '%; rolled ' + decRoll,
        });
        return finish('incomplete', 0, chain, meta);
      }
    }

    // 4 — throw quality
    const accT = 30 + trunc(qb.r.ACC / 2) + windowSz * 8;
    const accRoll = d100();
    const accMargin = accT - accRoll;
    const quality = accMargin >= 40 ? 'great' : accMargin >= 15 ? 'good'
                  : accMargin >= -10 ? 'ok' : accMargin >= -30 ? 'low' : 'bad';
    chain.push({
      key: 'throw', label: 'Throw', value: quality,
      status: (quality === 'great' || quality === 'good') ? 'good' : quality === 'ok' ? 'neutral' : 'bad',
      detail: qb.name + ' puts a ' + quality + ' ball into a ' + windowSz + '-yd window',
      math: 'acc target = 30 + ' + trunc(qb.r.ACC / 2) + ' + ' + (windowSz * 8) + ' (window) = ' +
            accT + '; rolled ' + accRoll,
    });

    // 5 — defender plays the ball (if anyone's in the window)
    const defender = inLane ? mlb : (sep === 0 ? nb : null);
    if (defender) {
      const qp = QUALITY_PENALTY[quality];
      const bsuT = 5 + trunc(defender.r.BSU / 4) + qp;
      const bsuRoll = d100();
      if (bsuRoll <= bsuT) {
        const intT = 10 + trunc(defender.r.BSU / 5);
        const intRoll = d100();
        if (intRoll <= intT) {
          meta.intercepted = true;
          chain.push({
            key: 'contest', label: 'Contest', status: 'bad', value: 'INTERCEPTED',
            detail: defender.name + ' jumps the route and picks it',
            math: 'break-up ' + bsuT + '% (rolled ' + bsuRoll + '); INT ' + intT + '% (rolled ' + intRoll + ')',
          });
          return finish('interception', -Math.max(0, trunc(d100() / 8)), chain, meta);
        }
        chain.push({
          key: 'contest', label: 'Contest', status: 'bad', value: 'broken up',
          detail: defender.name + ' knocks it away',
          math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
        });
        return finish('pbu', 0, chain, meta);
      }
      chain.push({
        key: 'contest', label: 'Contest', status: 'neutral', value: 'contested',
        detail: defender.name + ' is right there but can’t break it up',
        math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
      });
    }

    // 6 — catch
    const contested = !!defender;
    const catchT = 35 + trunc(slot.r.CTH / 2) + CATCH_BONUS[quality] -
                   (contested ? trunc(defender.r.BSU / 4) : 0);
    const catchRoll = d100();
    if (catchRoll > catchT) {
      chain.push({
        key: 'catch', label: 'Catch', status: 'bad', value: 'drop',
        detail: slot.name + ' can’t bring it in',
        math: 'catch ' + catchT + '%; rolled ' + catchRoll,
      });
      return finish('incomplete', 0, chain, meta);
    }
    meta.caught = true;
    chain.push({
      key: 'catch', label: 'Catch', status: 'good',
      value: contested ? 'contested catch' : 'caught',
      detail: slot.name + ' hauls it in',
      math: 'catch ' + catchT + '%; rolled ' + catchRoll,
    });

    // 7 — YAC
    const yacBonus = trunc((slot.r.BTK + slot.r.SPD - mlb.r.TKL - mlb.r.SPD) / 10);
    const yac = Math.max(0, YAC_BASE[route] + yacBonus + trunc(d100() / 25));
    chain.push({
      key: 'yac', label: 'Yards after catch', value: '+' + yac + ' yd', status: 'good',
      detail: slot.name + ' picks up ' + yac + ' after the catch',
      math: YAC_BASE[route] + ' + ' + yacBonus + ' (athleticism) + jitter = ' + yac,
    });

    return finish('completion', routeDepth(route) + yac, chain, meta);
  }

  function finish(outcome, yards, chain, meta) {
    meta.outcome = outcome;
    meta.yards = yards;
    return { outcome: outcome, yards: yards, chain: chain, meta: meta };
  }

  const api = { resolvePlay: resolvePlay, leverageBonus: leverageBonus,
                routeDepth: routeDepth, DEFAULT_PLAYERS: DEFAULT_PLAYERS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // Node
  } else {
    root.Sim = api;                  // browser → window.Sim
  }
})(typeof window !== 'undefined' ? window : this);
