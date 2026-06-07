// sim.js — pure game logic for Tactical Football. No DOM, so it runs in the
// browser and in Node (tests). Direct port of validation/simulate.py.
//
// resolvePlay() resolves ONE targeted receiver running ONE route against one
// defender + an underneath linebacker, under man (Cover 1), zone (Cover 3),
// or blitz. Routes live in a data table. The resolution chain:
//   read → separation → lane → pass rush (sack/hurry) → throw → contest → catch → YAC
// Risk lives in three places: the pass rush prices route depth (a deep route
// held too long gets sacked/hurried), and a forced throw into coverage gets
// thrown more, thrown worse, and picked more often.

(function (root) {
  'use strict';

  // ---------- dice / helpers ----------
  function d100() { return Math.floor(Math.random() * 100) + 1; }
  function trunc(n) { return Math.floor(n); }  // floors (matches Python //) so JS↔Python agree on negative-operand division
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  // ---------- route table (mirror simulate.py ROUTES) ----------
  //   depth, brk ('in'|'out'|null), manBase, zoneSep, zoneLane, yac, tt (time-to-throw, sec)
  const ROUTES = {
    slant: { depth: 5,  brk: 'in',  manBase: 0,  zoneSep: 6,   zoneLane: 28, yac: 2, tt: 1.4 },
    hitch: { depth: 5,  brk: null,  manBase: 0,  zoneSep: 22,  zoneLane: 6,  yac: 1, tt: 1.8 },
    out:   { depth: 6,  brk: 'out', manBase: 0,  zoneSep: -10, zoneLane: 42, yac: 2, tt: 1.9 },
    drag:  { depth: 4,  brk: null,  manBase: 12, zoneSep: 10,  zoneLane: 18, yac: 4, tt: 1.5 },
    dig:   { depth: 11, brk: 'in',  manBase: -4, zoneSep: 8,   zoneLane: 32, yac: 2, tt: 2.9 },
    curl:  { depth: 9,  brk: null,  manBase: 2,  zoneSep: 18,  zoneLane: 12, yac: 1, tt: 2.3 },
    flat:  { depth: 2,  brk: null,  manBase: 10, zoneSep: 16,  zoneLane: 8,  yac: 3, tt: 1.4 },
    // deep shots — slow to develop (a sack gamble), pay off in chunk yards on a clean read;
    // forcing one into coverage is the riskiest throw in the game (INT scales with depth)
    go:     { depth: 17, brk: null,  manBase: -9, zoneSep: -5,  zoneLane: 10, yac: 2, tt: 3.8 },
    post:   { depth: 16, brk: 'in',  manBase: -6, zoneSep: 5,   zoneLane: 18, yac: 2, tt: 3.4 },
    corner: { depth: 16, brk: 'out', manBase: -3, zoneSep: 4,   zoneLane: 10, yac: 1, tt: 3.2 },
  };

  const CATCH_BONUS = { great: 30, good: 15, ok: 0, low: -20, bad: -40 };
  const QUALITY_PENALTY = { great: -20, good: -10, ok: 0, low: 10, bad: 25 };

  // ---------- pass-rush model ----------
  const PROTECT = { base: 2.0, blitz: 1.5 };       // seconds the pocket holds
  const SACK = { base: 2, blitz: 9, perSec: 8 };   // sack% = base + perSec * (tt - protect), − QB mobility
  const HURRY = { base: 6, blitz: 15, perSec: 16 };

  function levTerm(brk, leverage) {
    if (!brk) return 0;
    if (brk === 'in') return leverage === 'outside' ? 10 : -10;
    return leverage === 'inside' ? 10 : -10;   // 'out'
  }
  function bucketSep(margin) {
    return margin >= 30 ? 3 : margin >= 10 ? 2 : margin >= -10 ? 1 : 0;
  }
  function routeDepth(route) { return (ROUTES[route] || ROUTES.slant).depth; }

  // Pure pre-snap read verdict ('good'|'neutral'|'bad') — used by the UI so the
  // field cue and the post-play breakdown can never drift from the math.
  function readStatus(route, coverage, leverage) {
    const rt = ROUTES[route] || ROUTES.slant;
    if (coverage === 'zone') return rt.zoneSep > 10 ? 'good' : rt.zoneSep >= 0 ? 'neutral' : 'bad';
    if (coverage === 'blitz') return rt.tt <= 1.6 ? 'good' : 'neutral';   // quick = safe; deeper = a viable high-EV shot (never auto-'bad' vs a vacated zone)
    const levB = levTerm(rt.brk, leverage);
    return levB > 0 ? 'good' : levB < 0 ? 'bad' : (rt.manBase >= 8 ? 'good' : 'neutral');
  }

  // Deterministic expected separation (the pre-roll sepTarget). DISPLAY-ONLY — drives
  // the visual gap in the read window. MUST mirror the sepTarget math in resolvePlay().
  function expectedSep(opts) {
    const rt = ROUTES[opts.route] || ROUTES.slant;
    const rec = opts.receiver, defn = opts.defender;
    if (opts.coverage === 'zone') return 56 + rt.zoneSep + trunc((rec.r.RTE - defn.r.ZON) / 4);
    const vacated = opts.coverage === 'blitz' ? 8 : 0;
    return 60 + rt.manBase + levTerm(rt.brk, opts.leverage)
         + trunc((rec.r.SPD - defn.r.SPD) / 4) + trunc((rec.r.RTE - defn.r.COV) / 2) + vacated;
  }

  // ---------- default demo roster ----------
  const DEFAULT_PLAYERS = {
    x:    { name: 'D. Hart',  num: 80, pos: 'WR', r: { SPD: 89, RTE: 86, CTH: 86, AWR: 82, BTK: 80, STA: 80 } },
    z:    { name: 'T. Ruiz',  num: 18, pos: 'WR', r: { SPD: 85, RTE: 79, CTH: 81, AWR: 77, BTK: 78, STA: 80 } },
    slot: { name: 'C. Reed',  num: 11, pos: 'WR', r: { SPD: 90, RTE: 88, CTH: 88, AWR: 85, BTK: 82, STA: 80 } },
    te:   { name: 'G. Olsen', num: 87, pos: 'TE', r: { SPD: 74, RTE: 76, CTH: 85, AWR: 80, BTK: 86, STA: 82 } },
    rb:   { name: 'A. Kane',  num: 28, pos: 'RB', r: { SPD: 88, RTE: 70, CTH: 78, AWR: 74, BTK: 88, STA: 84 } },
    qb:   { name: 'J. Vance', num: 9,  pos: 'QB', r: { ACC: 90, DEC: 88, ARM: 85, MOB: 75, AWR: 88, STA: 85 } },
    cbX:  { name: 'R. Slade', num: 24, pos: 'CB', r: { SPD: 88, COV: 85, ZON: 78, BSU: 83, AWR: 80, TKL: 72, STA: 80 } },
    cbZ:  { name: 'M. Pope',  num: 21, pos: 'CB', r: { SPD: 82, COV: 77, ZON: 74, BSU: 75, AWR: 74, TKL: 74, STA: 80 } },
    nb:   { name: 'M. Diallo',num: 27, pos: 'NB', r: { SPD: 74, COV: 72, ZON: 72, BSU: 70, AWR: 72, TKL: 70, STA: 80 } },
    ss:   { name: 'B. Cole',  num: 32, pos: 'SS', r: { SPD: 80, COV: 74, ZON: 80, BSU: 76, AWR: 82, TKL: 84, STA: 82 } },
    mlb:  { name: 'F. Boone', num: 54, pos: 'MLB',r: { COV: 76, ZON: 80, AWR: 82, TKL: 84, SPD: 80, BSU: 74, STA: 85 } },
    fs:   { name: 'D. Park',  num: 31, pos: 'FS', r: { SPD: 82, ZON: 80, BSU: 80, AWR: 82, TKL: 80, STA: 80 } },
  };

  // ---------- main resolver ----------
  // resolvePlay({ route, coverage, leverage, receiver, defender, lb, qb })
  //   coverage ∈ 'man' | 'zone' | 'blitz';  leverage ∈ 'inside' | 'outside' (man/blitz)
  // Returns { outcome, yards, chain, meta }. outcome ∈ completion|incomplete|pbu|interception|sack.
  function resolvePlay(opts) {
    const route = opts.route, coverage = opts.coverage, leverage = opts.leverage;
    const rec = opts.receiver, defn = opts.defender, lb = opts.lb, qb = opts.qb;
    const rt = ROUTES[route] || ROUTES.slant;
    const depthPen = trunc(Math.max(0, rt.depth - 5) / 2);
    const isBlitz = coverage === 'blitz';
    const isZone = coverage === 'zone';
    const chain = [];
    const meta = { route: route, coverage: coverage, leverage: leverage, receiver: rec.name,
                   undercut: false, sep: 0, window: 0, caught: false, intercepted: false,
                   sacked: false, hurried: false };

    // 1 — separation + read
    let sepTarget, sepRoll, sepMargin, levB = 0, badRead = false;
    if (isZone) {
      const rteDiff = trunc((rec.r.RTE - defn.r.ZON) / 4);
      sepTarget = 56 + rt.zoneSep + rteDiff;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      badRead = rt.zoneSep < 0;
      chain.push({
        key: 'read', label: 'Coverage', value: 'Cover 3 · ' + cap(route), status: readStatus(route, 'zone', leverage),
        detail: rt.zoneSep > 10 ? cap(route) + ' settles in the soft spot vs zone'
              : rt.zoneSep >= 0 ? cap(route) + ' works the zone underneath'
              : cap(route) + ' breaks into the curl-flat defender',
        math: 'sep = 56 ' + fmt(rt.zoneSep) + ' zone ' + fmt(rteDiff) + ' rte = ' + sepTarget + '; rolled ' + sepRoll,
      });
    } else {
      levB = levTerm(rt.brk, leverage);
      const spdDiff = trunc((rec.r.SPD - defn.r.SPD) / 4);
      const rteDiff = trunc((rec.r.RTE - defn.r.COV) / 2);
      const vacated = isBlitz ? 8 : 0;          // blitz vacates an underneath defender
      sepTarget = 60 + rt.manBase + levB + spdDiff + rteDiff + vacated;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      badRead = levB < 0;
      chain.push({
        key: 'read', label: 'Coverage', value: (isBlitz ? 'Blitz · ' : 'Man · ') + cap(route), status: readStatus(route, coverage, leverage),
        detail: isBlitz ? 'Blitz — a defender vacates underneath; quick throws beat the rush'
              : levB > 0 ? cap(route) + ' breaks away from ' + leverage + ' leverage (+10)'
              : levB < 0 ? cap(route) + ' breaks into ' + leverage + ' leverage (−10)'
              : rt.manBase >= 8 ? cap(route) + ' rubs free underneath' : cap(route) + ' is leverage-neutral',
        math: 'sep = 60 ' + fmt(rt.manBase) + ' route ' + fmt(levB) + ' lev ' + fmt(spdDiff) + ' spd ' +
              fmt(rteDiff) + ' rte' + (vacated ? ' +8 vacated' : '') + ' = ' + sepTarget + '; rolled ' + sepRoll,
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

    // 2 — defender in the throwing lane (none on a blitz — the robber is rushing)
    let laneTarget = 0;
    if (!isBlitz) laneTarget = isZone ? Math.max(2, rt.zoneLane + trunc((lb.r.AWR - 70) / 5)) : 3 + trunc((lb.r.AWR + lb.r.COV) / 12);
    const laneRoll = d100();
    const inLane = laneTarget > 0 && laneRoll <= laneTarget;
    meta.undercut = inLane;
    const windowSz = Math.max(0, sep - (inLane ? 1 : 0));
    meta.window = windowSz;
    chain.push({
      key: 'undercut', label: isBlitz ? 'Pressure' : (isZone ? 'Zone dropper' : 'LB in the lane'),
      status: isBlitz ? 'neutral' : (inLane ? 'bad' : 'good'),
      value: isBlitz ? 'rushing' : (inLane ? 'jumps the lane' : 'stays home'),
      detail: isBlitz ? lb.name + ' is coming on the blitz — the underneath lane is open'
            : inLane ? lb.name + ' sits in the throwing lane (window −1)' : lb.name + ' is out of the lane',
      math: isBlitz ? 'no underneath robber' : 'lane chance ' + laneTarget + '%; rolled ' + laneRoll,
    });

    // 3 — pass rush / pocket clock: holding a deep route lets the rush home
    const protect = isBlitz ? PROTECT.blitz : PROTECT.base;
    const excess = Math.max(0, rt.tt - protect);
    const mobAdj = Math.max(0, trunc((qb.r.MOB - 72) / 3));
    const sackP = clamp((isBlitz ? SACK.blitz : SACK.base) + trunc(excess * SACK.perSec) - mobAdj, 0, 42);
    const hurryP = clamp((isBlitz ? HURRY.blitz : HURRY.base) + trunc(excess * HURRY.perSec) - mobAdj, 0, 60);
    const pRoll = d100();
    let hurried = false;
    if (pRoll <= sackP) {
      meta.sacked = true;
      chain.push({
        key: 'pressure', label: 'Pass rush', status: 'bad', value: 'SACK',
        detail: 'The rush gets home before the ' + route + ' (' + rt.tt + 's) develops',
        math: 'sack ' + sackP + '%; rolled ' + pRoll,
      });
      return finish('sack', -(4 + trunc(d100() / 20)), chain, meta);   // −4..−9
    } else if (pRoll <= sackP + hurryP) {
      hurried = true; meta.hurried = true;
      chain.push({
        key: 'pressure', label: 'Pass rush', status: 'neutral', value: 'hurried',
        detail: qb.name + ' has to rush it — the pocket is collapsing',
        math: 'sack ' + sackP + '% / hurry ' + hurryP + '%; rolled ' + pRoll,
      });
    } else {
      chain.push({
        key: 'pressure', label: 'Pocket', status: 'good', value: 'clean',
        detail: qb.name + ' has time to throw', math: 'sack ' + sackP + '% / hurry ' + hurryP + '%; rolled ' + pRoll,
      });
    }

    // 4 — QB decision when there's no window (a forced ball gets thrown, not checked down)
    if (windowSz === 0) {
      let decT = 45 + trunc(qb.r.DEC / 2);
      if (badRead) decT -= 25;
      const decRoll = d100();
      if (decRoll <= decT) {
        chain.push({
          key: 'decision', label: 'QB read', status: 'neutral', value: 'check down',
          detail: qb.name + ' sees no window and checks it down', math: 'recognise ' + decT + '%; rolled ' + decRoll,
        });
        return finish('incomplete', 0, chain, meta);
      }
    }

    // 5 — throw quality (hurried + forced-into-coverage degrade it)
    let accT = 30 + trunc(qb.r.ACC / 2) + windowSz * 8 - depthPen;
    if (hurried) accT -= 14;
    if (windowSz === 0 && badRead) accT -= 12 + Math.max(0, rt.depth - 5);
    const accRoll = d100();
    const accMargin = accT - accRoll;
    const quality = accMargin >= 40 ? 'great' : accMargin >= 15 ? 'good' : accMargin >= -10 ? 'ok' : accMargin >= -30 ? 'low' : 'bad';
    chain.push({
      key: 'throw', label: 'Throw', value: quality,
      status: (quality === 'great' || quality === 'good') ? 'good' : quality === 'ok' ? 'neutral' : 'bad',
      detail: qb.name + ' puts a ' + quality + ' ball into a ' + windowSz + '-yd window' + (hurried ? ' under pressure' : ''),
      math: 'acc = 30 + ' + trunc(qb.r.ACC / 2) + ' + ' + (windowSz * 8) + ' win − ' + depthPen + ' depth' +
            (hurried ? ' − 14 hurry' : '') + ((windowSz === 0 && badRead) ? ' − forced' : '') + ' = ' + accT + '; rolled ' + accRoll,
    });

    // 6 — defender plays the ball (continuous INT risk: worse on forced + deep throws)
    const defender = inLane ? lb : (sep === 0 ? defn : null);
    if (defender) {
      const bsuT = 5 + trunc(defender.r.BSU / 4) + QUALITY_PENALTY[quality];
      const bsuRoll = d100();
      if (bsuRoll <= bsuT) {
        const intT = 10 + trunc(defender.r.BSU / 5) + (windowSz === 0 ? 8 : 0) + Math.max(0, rt.depth - 5) * 2;
        const intRoll = d100();
        if (intRoll <= intT) {
          meta.intercepted = true;
          chain.push({
            key: 'contest', label: 'Contest', status: 'bad', value: 'INTERCEPTED',
            detail: defender.name + ' jumps the route and picks it',
            math: 'break-up ' + bsuT + '% (rolled ' + bsuRoll + '); INT ' + intT + '% (rolled ' + intRoll + ')',
          });
          return finish('interception', 0, chain, meta);
        }
        chain.push({
          key: 'contest', label: 'Contest', status: 'bad', value: 'broken up',
          detail: defender.name + ' knocks it away', math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
        });
        return finish('pbu', 0, chain, meta);
      }
      chain.push({
        key: 'contest', label: 'Contest', status: 'neutral', value: 'contested',
        detail: defender.name + ' is right there but can’t break it up', math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
      });
    }

    // 7 — catch
    const contested = !!defender;
    const catchT = 35 + trunc(rec.r.CTH / 2) + CATCH_BONUS[quality] - (contested ? trunc(defender.r.BSU / 4) : 0);
    const catchRoll = d100();
    if (catchRoll > catchT) {
      chain.push({
        key: 'catch', label: 'Catch', status: 'bad', value: 'drop',
        detail: rec.name + ' can’t bring it in', math: 'catch ' + catchT + '%; rolled ' + catchRoll,
      });
      return finish('incomplete', 0, chain, meta);
    }
    meta.caught = true;
    chain.push({
      key: 'catch', label: 'Catch', status: 'good', value: contested ? 'contested catch' : 'caught',
      detail: rec.name + ' hauls it in', math: 'catch ' + catchT + '%; rolled ' + catchRoll,
    });

    // 8 — YAC
    const yac = Math.max(0, rt.yac + trunc((rec.r.BTK + rec.r.SPD - lb.r.TKL - lb.r.SPD) / 10) + trunc(d100() / 25));
    chain.push({
      key: 'yac', label: 'Yards after catch', value: '+' + yac + ' yd', status: 'good',
      detail: rec.name + ' picks up ' + yac + ' after the catch', math: rt.yac + ' + athleticism + jitter = ' + yac,
    });

    return finish('completion', rt.depth + yac, chain, meta);
  }

  function finish(outcome, yards, chain, meta) {
    meta.outcome = outcome; meta.yards = yards;
    return { outcome: outcome, yards: yards, chain: chain, meta: meta };
  }

  const api = { resolvePlay: resolvePlay, ROUTES: ROUTES, routeDepth: routeDepth,
                levTerm: levTerm, readStatus: readStatus, expectedSep: expectedSep, DEFAULT_PLAYERS: DEFAULT_PLAYERS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  else root.Sim = api;                                                         // browser
})(typeof window !== 'undefined' ? window : this);
