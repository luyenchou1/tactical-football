// sim.js — pure game logic for the Tactical Football web prototype.
// No DOM here, so it runs in both the browser and Node (for testing).
//
// This is a direct port of the Swift `SlantVsCover1` resolver + the Python
// validation mirror, with ONE addition: the player chooses the slot's route,
// and that choice interacts with the defender's leverage. That interaction is
// the core "chess move" of the prototype.
//
//   Leverage rule (man coverage):
//     - CB shades OUTSIDE  → slant (breaks inside) wins; out (breaks outside) loses
//     - CB shades INSIDE   → out wins; slant loses
//     - hitch is leverage-neutral (a safe, smaller gain)

(function (root) {
  'use strict';

  // ---------- dice ----------
  function d100() { return Math.floor(Math.random() * 100) + 1; }
  function trunc(n) { return Math.trunc(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  // ---------- default roster (ratings 45–95) ----------
  // r = rating block. Only the keys a position actually uses are read.
  const DEFAULT_PLAYERS = {
    slot: { name: 'C. Reed',  num: 11, pos: 'WR',
            r: { SPD: 90, RTE: 88, CTH: 88, AWR: 85, BTK: 82, STA: 80 } },
    qb:   { name: 'J. Vance', num: 9,  pos: 'QB',
            r: { ACC: 90, DEC: 88, ARM: 85, MOB: 75, AWR: 88, STA: 85 } },
    nb:   { name: 'M. Diallo', num: 27, pos: 'NB',
            r: { SPD: 74, COV: 72, BSU: 70, AWR: 72, TKL: 70, STA: 80 } },
    mlb:  { name: 'F. Boone', num: 54, pos: 'MLB',
            r: { COV: 80, AWR: 82, TKL: 84, SPD: 80, BSU: 78, STA: 85 } },
    fs:   { name: 'D. Park',  num: 31, pos: 'FS',
            r: { SPD: 82, ZON: 80, BSU: 80, AWR: 82, TKL: 80, STA: 80 } },
  };

  // ---------- leverage / route read ----------
  function leverageBonus(route, leverage) {
    if (route === 'hitch') return 0;
    if (route === 'slant') return leverage === 'outside' ? 10 : -10;
    if (route === 'out')   return leverage === 'inside'  ? 10 : -10;
    return 0;
  }

  function routeDepth(route) {
    if (route === 'out') return 6;
    if (route === 'hitch') return 4;
    return 5; // slant
  }

  // ---------- main resolver ----------
  // Returns { outcome, yards, chain:[steps], meta:{...} }
  // outcome ∈ 'completion' | 'incomplete' | 'pbu' | 'interception'
  function resolvePlay(route, leverage, players) {
    const P = players || DEFAULT_PLAYERS;
    const slot = P.slot, qb = P.qb, nb = P.nb, mlb = P.mlb;
    const chain = [];
    const meta = { route: route, leverage: leverage, undercut: false,
                   sep: 0, window: 0, caught: false, intercepted: false };

    // 1 — separation (route choice vs leverage is the heart of it)
    const lev = leverageBonus(route, leverage);
    const spdDiff = trunc((slot.r.SPD - nb.r.SPD) / 4);
    const rteDiff = trunc((slot.r.RTE - nb.r.COV) / 2);
    const sepTarget = 60 + lev + spdDiff + rteDiff;
    const sepRoll = d100();
    const sepMargin = sepTarget - sepRoll;
    const sep = sepMargin >= 30 ? 3 : sepMargin >= 10 ? 2 : sepMargin >= -10 ? 1 : 0;
    meta.sep = sep;

    chain.push({
      key: 'leverage', label: 'Leverage read',
      status: lev > 0 ? 'good' : lev < 0 ? 'bad' : 'neutral',
      value: cap(route) + ' vs ' + leverage,
      detail: lev > 0
        ? cap(route) + ' breaks away from ' + leverage + ' leverage (+10 sep)'
        : lev < 0
          ? cap(route) + ' breaks into ' + leverage + ' leverage (−10 sep)'
          : cap(route) + ' is leverage-neutral',
      math: 'sep target = 60 ' + fmt(lev) + ' lev ' + fmt(spdDiff) + ' spd ' +
            fmt(rteDiff) + ' route = ' + sepTarget + '; rolled ' + sepRoll,
    });
    chain.push({
      key: 'separation', label: 'Separation', value: sep + ' yd',
      status: sep >= 2 ? 'good' : sep === 1 ? 'neutral' : 'bad',
      detail: sep >= 2 ? 'Receiver wins clean' : sep === 1 ? 'A step of room' : 'Blanketed',
      math: 'margin ' + sepMargin + ' → ' + sep + ' yd of separation',
    });

    // 2 — MLB undercut (rare)
    const ucTarget = 3 + trunc((mlb.r.AWR + mlb.r.COV) / 12);
    const ucRoll = d100();
    const undercut = ucRoll <= ucTarget;
    meta.undercut = undercut;
    const window = Math.max(0, sep - (undercut ? 1 : 0));
    meta.window = window;
    chain.push({
      key: 'undercut', label: 'LB in the lane',
      status: undercut ? 'bad' : 'good',
      value: undercut ? 'undercuts' : 'stays home',
      detail: undercut
        ? mlb.name + ' jumps the throwing lane (window −1)'
        : mlb.name + ' stays underneath, lane open',
      math: 'undercut chance ' + ucTarget + '%; rolled ' + ucRoll,
    });

    // 3 — QB decision when there's no window
    if (window === 0) {
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
    const accT = 30 + trunc(qb.r.ACC / 2) + window * 8;
    const accRoll = d100();
    const accMargin = accT - accRoll;
    const quality = accMargin >= 40 ? 'great' : accMargin >= 15 ? 'good'
                  : accMargin >= -10 ? 'ok' : accMargin >= -30 ? 'low' : 'bad';
    chain.push({
      key: 'throw', label: 'Throw', value: quality,
      status: (quality === 'great' || quality === 'good') ? 'good'
            : quality === 'ok' ? 'neutral' : 'bad',
      detail: qb.name + ' puts a ' + quality + ' ball into a ' + window + '-yd window',
      math: 'acc target = 30 + ' + trunc(qb.r.ACC / 2) + ' + ' + (window * 8) +
            ' (window) = ' + accT + '; rolled ' + accRoll,
    });

    // 5 — defender plays the ball (if anyone's in the window)
    const defender = undercut ? mlb : (sep === 0 ? nb : null);
    if (defender) {
      const qp = { great: -20, good: -10, ok: 0, low: 10, bad: 25 }[quality];
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
            math: 'break-up ' + bsuT + '% (rolled ' + bsuRoll + '); INT ' + intT +
                  '% (rolled ' + intRoll + ')',
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
    const cbonus = { great: 30, good: 15, ok: 0, low: -20, bad: -40 }[quality];
    const catchT = 35 + trunc(slot.r.CTH / 2) + cbonus -
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
    const yacJ = trunc(d100() / 25);
    const yac = Math.max(0, 2 + yacBonus + yacJ);
    chain.push({
      key: 'yac', label: 'Yards after catch', value: '+' + yac + ' yd', status: 'good',
      detail: slot.name + ' picks up ' + yac + ' after the catch',
      math: '2 + ' + yacBonus + ' (athleticism) + ' + yacJ + ' = ' + yac,
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
