// sim.js — pure game logic for Tactical Football. No DOM, so it runs in the
// browser and in Node (for tests). Direct port of validation/simulate.py.
//
// resolvePlay() resolves ONE targeted receiver running ONE route against one
// defender + an underneath linebacker, under man (Cover 1) or zone (Cover 3).
// Routes live in a data table so adding one is just a row.

(function (root) {
  'use strict';

  // ---------- dice / helpers ----------
  function d100() { return Math.floor(Math.random() * 100) + 1; }
  function trunc(n) { return Math.trunc(n); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmt(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  // ---------- route table (mirror simulate.py ROUTES) ----------
  //   depth, brk ('in'|'out'|null), manBase, zoneSep, zoneLane, yac
  const ROUTES = {
    slant: { depth: 5,  brk: 'in',  manBase: 0,  zoneSep: 6,   zoneLane: 28, yac: 2 },
    hitch: { depth: 5,  brk: null,  manBase: 0,  zoneSep: 22,  zoneLane: 6,  yac: 1 },
    out:   { depth: 6,  brk: 'out', manBase: 0,  zoneSep: -10, zoneLane: 42, yac: 2 },
    drag:  { depth: 4,  brk: null,  manBase: 12, zoneSep: 10,  zoneLane: 18, yac: 4 },
    dig:   { depth: 11, brk: 'in',  manBase: -4, zoneSep: 8,   zoneLane: 32, yac: 2 },
    curl:  { depth: 9,  brk: null,  manBase: 2,  zoneSep: 18,  zoneLane: 12, yac: 1 },
    flat:  { depth: 2,  brk: null,  manBase: 10, zoneSep: 16,  zoneLane: 8,  yac: 3 },
  };

  const CATCH_BONUS = { great: 30, good: 15, ok: 0, low: -20, bad: -40 };
  const QUALITY_PENALTY = { great: -20, good: -10, ok: 0, low: 10, bad: 25 };

  function levTerm(brk, leverage) {
    if (!brk) return 0;
    if (brk === 'in') return leverage === 'outside' ? 10 : -10;
    return leverage === 'inside' ? 10 : -10;   // 'out'
  }
  function bucketSep(margin) {
    return margin >= 30 ? 3 : margin >= 10 ? 2 : margin >= -10 ? 1 : 0;
  }
  function routeDepth(route) { return (ROUTES[route] || ROUTES.slant).depth; }

  // ---------- default demo roster ----------
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

  // ---------- main resolver ----------
  // resolvePlay({ route, coverage, leverage, receiver, defender, lb, qb })
  //   coverage ∈ 'man' | 'zone';  leverage ∈ 'inside' | 'outside' (man only)
  //   receiver / defender / lb / qb are player objects ({ name, r:{...} })
  // Returns { outcome, yards, chain:[steps], meta:{...} }.
  function resolvePlay(opts) {
    const route = opts.route, coverage = opts.coverage, leverage = opts.leverage;
    const rec = opts.receiver, defn = opts.defender, lb = opts.lb, qb = opts.qb;
    const rt = ROUTES[route] || ROUTES.slant;
    const depthPen = trunc(Math.max(0, rt.depth - 5) / 2);
    const chain = [];
    const meta = { route: route, coverage: coverage, leverage: leverage,
                   receiver: rec.name, undercut: false, sep: 0, window: 0,
                   caught: false, intercepted: false };

    // 1 — separation (the read lives here)
    let sepTarget, sepRoll, sepMargin;
    if (coverage === 'man') {
      const levB = levTerm(rt.brk, leverage);
      const spdDiff = trunc((rec.r.SPD - defn.r.SPD) / 4);
      const rteDiff = trunc((rec.r.RTE - defn.r.COV) / 2);
      sepTarget = 60 + rt.manBase + levB + spdDiff + rteDiff;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      const st = levB > 0 ? 'good' : levB < 0 ? 'bad' : (rt.manBase >= 8 ? 'good' : 'neutral');
      chain.push({
        key: 'read', label: 'Coverage', value: 'Man · ' + cap(route), status: st,
        detail: levB > 0 ? cap(route) + ' breaks away from ' + leverage + ' leverage (+10)'
              : levB < 0 ? cap(route) + ' breaks into ' + leverage + ' leverage (−10)'
              : rt.manBase >= 8 ? cap(route) + ' rubs free underneath' : cap(route) + ' is leverage-neutral',
        math: 'sep = 60 ' + fmt(rt.manBase) + ' route ' + fmt(levB) + ' lev ' + fmt(spdDiff) +
              ' spd ' + fmt(rteDiff) + ' rte = ' + sepTarget + '; rolled ' + sepRoll,
      });
    } else {
      const rteDiff = trunc((rec.r.RTE - defn.r.ZON) / 4);
      sepTarget = 56 + rt.zoneSep + rteDiff;
      sepRoll = d100(); sepMargin = sepTarget - sepRoll;
      const st = rt.zoneSep > 10 ? 'good' : rt.zoneSep >= 0 ? 'neutral' : 'bad';
      chain.push({
        key: 'read', label: 'Coverage', value: 'Cover 3 · ' + cap(route), status: st,
        detail: rt.zoneSep > 10 ? cap(route) + ' settles in the soft spot vs zone'
              : rt.zoneSep >= 0 ? cap(route) + ' works the zone underneath'
              : cap(route) + ' breaks into the curl-flat defender',
        math: 'sep = 56 ' + fmt(rt.zoneSep) + ' zone ' + fmt(rteDiff) + ' rte = ' + sepTarget + '; rolled ' + sepRoll,
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
    if (coverage === 'man') laneTarget = 3 + trunc((lb.r.AWR + lb.r.COV) / 12);
    else laneTarget = Math.max(2, rt.zoneLane + trunc((lb.r.AWR - 70) / 5));
    const laneRoll = d100();
    const inLane = laneRoll <= laneTarget;
    meta.undercut = inLane;
    const windowSz = Math.max(0, sep - (inLane ? 1 : 0));
    meta.window = windowSz;
    chain.push({
      key: 'undercut', label: coverage === 'man' ? 'LB in the lane' : 'Zone dropper',
      status: inLane ? 'bad' : 'good', value: inLane ? 'jumps the lane' : 'stays home',
      detail: inLane ? lb.name + ' sits in the throwing lane (window −1)' : lb.name + ' is out of the lane',
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
    const accT = 30 + trunc(qb.r.ACC / 2) + windowSz * 8 - depthPen;
    const accRoll = d100();
    const accMargin = accT - accRoll;
    const quality = accMargin >= 40 ? 'great' : accMargin >= 15 ? 'good'
                  : accMargin >= -10 ? 'ok' : accMargin >= -30 ? 'low' : 'bad';
    chain.push({
      key: 'throw', label: 'Throw', value: quality,
      status: (quality === 'great' || quality === 'good') ? 'good' : quality === 'ok' ? 'neutral' : 'bad',
      detail: qb.name + ' puts a ' + quality + ' ball into a ' + windowSz + '-yd window',
      math: 'acc = 30 + ' + trunc(qb.r.ACC / 2) + ' + ' + (windowSz * 8) + ' win − ' + depthPen +
            ' depth = ' + accT + '; rolled ' + accRoll,
    });

    // 5 — defender plays the ball
    const defender = inLane ? lb : (sep === 0 ? defn : null);
    if (defender) {
      const bsuT = 5 + trunc(defender.r.BSU / 4) + QUALITY_PENALTY[quality];
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
          detail: defender.name + ' knocks it away', math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
        });
        return finish('pbu', 0, chain, meta);
      }
      chain.push({
        key: 'contest', label: 'Contest', status: 'neutral', value: 'contested',
        detail: defender.name + ' is right there but can’t break it up', math: 'break-up ' + bsuT + '%; rolled ' + bsuRoll,
      });
    }

    // 6 — catch
    const contested = !!defender;
    const catchT = 35 + trunc(rec.r.CTH / 2) + CATCH_BONUS[quality] -
                   (contested ? trunc(defender.r.BSU / 4) : 0);
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

    // 7 — YAC
    const yac = Math.max(0, rt.yac + trunc((rec.r.BTK + rec.r.SPD - lb.r.TKL - lb.r.SPD) / 10) + trunc(d100() / 25));
    chain.push({
      key: 'yac', label: 'Yards after catch', value: '+' + yac + ' yd', status: 'good',
      detail: rec.name + ' picks up ' + yac + ' after the catch',
      math: rt.yac + ' + athleticism + jitter = ' + yac,
    });

    return finish('completion', rt.depth + yac, chain, meta);
  }

  function finish(outcome, yards, chain, meta) {
    meta.outcome = outcome; meta.yards = yards;
    return { outcome: outcome, yards: yards, chain: chain, meta: meta };
  }

  const api = { resolvePlay: resolvePlay, ROUTES: ROUTES, routeDepth: routeDepth,
                levTerm: levTerm, DEFAULT_PLAYERS: DEFAULT_PLAYERS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node
  else root.Sim = api;                                                         // browser
})(typeof window !== 'undefined' ? window : this);
