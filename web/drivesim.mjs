// drivesim.mjs — drive-level balance simulator for Tactical Football.
// Requires the REAL engine (web/sim.js). Models a 5-drive game:
//   - each player drive: pick-play -> pick-target -> snap, resolved by Sim.resolvePlay
//   - drive ends on TD / turnover-on-downs / INT (advanceDown logic mirrored from game.js)
//   - between player drives, a REAL CPU drive: the rival offense (oppQb + opp receivers)
//     runs the same engine vs a random-proxy user defense — the brain below MIRRORS
//     game.js (keep in lockstep). Starts at their 35; FG/punt on 4th down.
//   - defense per play: zone 0.35 / blitz 0.20 / man 0.45 (mirror game.js newPlay)
//   - per-defender leverage: random inside/outside (mirror game.js levMap)
// Win = final player score > CPU score over 5 drives.
//
// Three target pickers compared:
//   random   — pick a random play, then a random target receiver
//   smart    — pick the play+target whose Sim.readStatus is best (good>neutral>bad),
//              tie-broken by route depth (slightly prefers more yards on a 'good' read)
//   deepest  — always pick the play+target with the deepest route
//
// Usage: node drivesim.mjs [games]

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Sim = require('./sim.js');
const P = Sim.DEFAULT_PLAYERS;

// ---- mirror game.js tables ----
const ELIGIBLE = [
  { key: 'x',    defKey: 'cbX' },
  { key: 'z',    defKey: 'cbZ' },
  { key: 'slot', defKey: 'nb'  },
  { key: 'te',   defKey: 'ss'  },
  { key: 'rb',   defKey: 'mlb' },
];
const PLAYS = [
  { id: 'slants',  routes: { x: 'slant', z: 'slant', slot: 'slant', te: 'drag', rb: 'flat' } },
  { id: 'mesh',    routes: { x: 'dig',   z: 'drag',  slot: 'drag',  te: 'curl', rb: 'flat' } },
  { id: 'stick',   routes: { x: 'out',   z: 'curl',  slot: 'hitch', te: 'dig',  rb: 'flat' } },
  { id: 'spacing', routes: { x: 'hitch', z: 'out',   slot: 'curl',  te: 'drag', rb: 'flat' } },
  { id: 'verticals', routes: { x: 'go',  z: 'go',    slot: 'post',  te: 'corner', rb: 'flat' } },
  { id: 'smash',   routes: { x: 'hitch', z: 'corner', slot: 'hitch', te: 'drag', rb: 'flat' } },
  { id: 'screen',  routes: { x: 'go',    z: 'hitch', slot: 'go',    te: 'curl', rb: 'screen' } },
  { id: 'flood',   routes: { x: 'dig',   z: 'corner', slot: 'sail',  te: 'drag', rb: 'flat' } },
  { id: 'wheel',   routes: { x: 'go',    z: 'post',  slot: 'drag',  te: 'dig',  rb: 'wheel' } },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Build the full set of (play, eligible) options for a given coverage/leverage map.
function options(coverage, levMap) {
  const opts = [];
  for (const pl of PLAYS) {
    for (const e of ELIGIBLE) {
      const route = pl.routes[e.key];
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      opts.push({ pl, e, route, lev, status: Sim.readStatus(route, coverage, lev) });
    }
  }
  return opts;
}

const STATUS_RANK = { good: 2, neutral: 1, bad: 0 };

function chooseRandom(opts) { return pick(opts); }

function chooseSmart(opts) {
  // best read; tie-break by deeper route (more reward on a safe read). NOTE: this realistic
  // reader does NOT perfectly exploit the screen — a perfect-info reader that always screens vs
  // blitz hits ~80%+ (the screen is a no-risk blitz answer), but the in-game coverage DISGUISE
  // gates that: you must read the blitz under the timer to call it. So the proxy stays honest at ~70.
  let best = opts[0];
  for (const o of opts) {
    const a = STATUS_RANK[o.status], b = STATUS_RANK[best.status];
    if (a > b || (a === b && Sim.routeDepth(o.route) > Sim.routeDepth(best.route))) best = o;
  }
  return best;
}

function chooseDeepest(opts) {
  let best = opts[0];
  for (const o of opts) if (Sim.routeDepth(o.route) > Sim.routeDepth(best.route)) best = o;
  return best;
}

// ---- mirror game.js advanceDown ----
// Returns updated drive state + whether the drive ended and how.
function advance(state, result) {
  state.plays += 1;
  if (result.outcome === 'interception') { state.over = true; state.res = 'int'; return; }
  const gain = result.yards | 0;                 // negative on a sack
  state.ballOn = Math.max(1, state.ballOn + gain);
  state.distance -= gain;
  if (state.ballOn >= 100) { state.ballOn = 100; state.score += 7; state.over = true; state.res = 'td'; }
  else if (gain > 0 && state.distance <= 0) { state.down = 1; state.distance = (100 - state.ballOn <= 10) ? (100 - state.ballOn) : 10; }
  else { state.down += 1; if (state.down > 4) { state.over = true; state.res = 'downs'; } }
}

// Play one player drive with a given target-picker. Returns points scored this drive.
function playDrive(chooser, stats) {
  const state = { ballOn: 25, down: 1, distance: 10, plays: 0, over: false, res: null, score: 0 };
  let guard = 0;
  while (!state.over && guard++ < 200) {
    // defense calls coverage + leverage (mirror game.js newPlay)
    const cr = Math.random();
    const coverage = cr < 0.35 ? 'zone' : cr < 0.55 ? 'blitz' : 'man';
    const levMap = {};
    for (const k of ['cbX', 'cbZ', 'nb', 'ss', 'mlb']) levMap[k] = Math.random() < 0.5 ? 'outside' : 'inside';

    const opts = options(coverage, levMap);
    const choice = chooser(opts);
    const e = choice.e;
    const result = Sim.resolvePlay({
      route: choice.route, coverage, leverage: levMap[e.defKey],
      receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb,
    });
    if (stats) { stats.plays++; stats.byOutcome[result.outcome] = (stats.byOutcome[result.outcome] || 0) + 1; }
    advance(state, result);
  }
  return state.score;
}

// ---- the CPU QB brain (MIRROR of game.js coach-the-defense — keep in lockstep) ----
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const BRAIN_W = {
  short: { slants: 3, mesh: 2.5, stick: 2, spacing: 2, smash: 1, flood: 1, screen: 1, verticals: .5, wheel: .5 },
  med:   { slants: 2, mesh: 2, stick: 2, spacing: 2, smash: 2, flood: 2, screen: 1, verticals: 1, wheel: 1 },
  long:  { slants: 1, mesh: 1.5, stick: 2, spacing: 2, smash: 2, flood: 2.5, screen: 1, verticals: 1.5, wheel: 1.5 },
  xlong: { slants: .5, mesh: 1.5, stick: 1, spacing: 1, smash: 2, flood: 2.5, screen: 1.5, verticals: 2.5, wheel: 2 },
};
const COV_MULT = {
  blitz: { screen: 3, slants: 2, mesh: 1.5 },
  zone:  { stick: 1.6, spacing: 1.6, flood: 1.6, smash: 1.3 },
  man:   { mesh: 1.6, slants: 1.4, wheel: 1.6 },
};
const ELIGIBLE_DEF = [
  { key: 'oppX',    routeKey: 'x',    defKey: 'myCbX' },
  { key: 'oppZ',    routeKey: 'z',    defKey: 'myCbZ' },
  { key: 'oppSlot', routeKey: 'slot', defKey: 'myNb'  },
  { key: 'oppTe',   routeKey: 'te',   defKey: 'mySs'  },
  { key: 'oppRb',   routeKey: 'rb',   defKey: 'myMlb' },
];

function brainPickPlay(distance, believed) {
  const bucket = distance <= 3 ? 'short' : distance <= 7 ? 'med' : distance <= 12 ? 'long' : 'xlong';
  const w = BRAIN_W[bucket], mult = COV_MULT[believed] || {};
  let total = 0;
  const weights = PLAYS.map((pl) => { const v = (w[pl.id] || 1) * (mult[pl.id] || 1); total += v; return v; });
  let roll = Math.random() * total;
  for (let i = 0; i < PLAYS.length; i++) { roll -= weights[i]; if (roll <= 0) return PLAYS[i]; }
  return PLAYS[PLAYS.length - 1];
}
function brainPickTarget(play, believed, levMap) {
  const ranked = ELIGIBLE_DEF.map((e) => {
    const route = play.routes[e.routeKey];
    const lev = believed === 'zone' ? null : levMap[e.defKey];
    return { e, route, score: STATUS_RANK[Sim.readStatus(route, believed, lev)] * 100 + Sim.routeDepth(route) };
  }).sort((a, b) => b.score - a.score);
  const r = Math.random();                              // ε-greedy: 75% best / 18% second / 7% the rest
  if (r < 0.75) return ranked[0];
  if (r < 0.93) return ranked[1];
  return ranked[2 + Math.floor(Math.random() * 3)];
}

// One REAL CPU drive vs a defense chooser ({coverage, shown} per play). Mirror of game.js
// runDefPossession: start at their 35; on 4th down kick a FG (in range) or punt — never go.
function playDefDrive(defChooser) {
  const state = { ballOn: 34, down: 1, distance: 10, plays: 0, over: false, res: null, score: 0 };
  const sniffP = clamp(Math.floor(P.oppQb.r.DEC / 3) / 100, 0.20, 0.33);
  let guard = 0;
  while (!state.over && guard++ < 200) {
    if (state.down === 4) {
      if (state.ballOn >= 65) {
        const dist = (100 - state.ballOn) + 17;
        const makeP = clamp(1.02 - 0.014 * (dist - 20), 0.15, 0.96);
        if (Math.random() < makeP) { state.score += 3; state.res = 'fg'; } else { state.res = 'fgmiss'; }
      } else { state.res = 'punt'; }
      state.over = true;
      break;
    }
    const call = defChooser(state);
    const levMap = {};
    for (const k of ['myCbX', 'myCbZ', 'myNb', 'mySs', 'myMlb']) levMap[k] = Math.random() < 0.5 ? 'outside' : 'inside';
    const believed = Math.random() < sniffP ? call.coverage : call.shown;   // he sniffs the bluff sniffP of the time
    const play = brainPickPlay(state.distance, believed);
    const choice = brainPickTarget(play, believed, levMap);
    const result = Sim.resolvePlay({
      route: choice.route, coverage: call.coverage, leverage: levMap[choice.e.defKey],
      receiver: P[choice.e.key], defender: P[choice.e.defKey], lb: P.myMlb, qb: P.oppQb,
    });
    advance(state, result);
  }
  return state.score;
}

// The proxy user-defense for balance runs: coverage 45/35/20, honest look 75% (mirror newPlay).
function defRandomProxy() {
  const cr = Math.random();
  const coverage = cr < 0.35 ? 'zone' : cr < 0.55 ? 'blitz' : 'man';
  let shown = coverage;
  if (Math.random() < 0.25) {
    const others = ['man', 'zone', 'blitz'].filter((l) => l !== coverage);
    shown = others[Math.floor(Math.random() * others.length)];
  }
  return { coverage, shown };
}

const DRIVES_PER_GAME = 5;

// Play one full game; return { win, tie, loss, playerScore, cpuScore }.
function playGame(chooser, stats) {
  let player = 0, cpu = 0;
  for (let d = 0; d < DRIVES_PER_GAME; d++) {
    player += playDrive(chooser, stats);
    cpu += playDefDrive(defRandomProxy);   // one REAL CPU drive per player drive
  }
  return { win: player > cpu, tie: player === cpu, loss: player < cpu, player, cpu };
}

function measure(name, chooser, games) {
  const stats = { plays: 0, byOutcome: {} };
  let wins = 0, ties = 0, losses = 0, totP = 0, totC = 0;
  for (let g = 0; g < games; g++) {
    const r = playGame(chooser, stats);
    if (r.win) wins++; else if (r.tie) ties++; else losses++;
    totP += r.player; totC += r.cpu;
  }
  return {
    name, games, wins, ties, losses,
    winPct: wins / games * 100,
    winPlusHalfTie: (wins + 0.5 * ties) / games * 100,
    avgPlayer: totP / games, avgCpu: totC / games,
    stats,
  };
}

const games = Number(process.argv[2] || 20000);

console.log(`Drive-level win rates — ${games} games each — CPU = REAL drives (Mercer's offense, start@35), def zone.35/blitz.20/man.45`);
console.log('='.repeat(96));
// coverage headroom: what the CPU averages per possession against each fixed defensive call
{
  const N = Math.max(4000, Math.floor(games / 4));
  const fixed = (cov) => () => ({ coverage: cov, shown: cov });
  const pts = (chooser) => { let t = 0; for (let i = 0; i < N; i++) t += playDefDrive(chooser); return (t / N).toFixed(2); };
  console.log(`CPU pts/poss vs fixed coverage — man ${pts(fixed('man'))} · zone ${pts(fixed('zone'))} · blitz ${pts(fixed('blitz'))} · random ${pts(defRandomProxy)}  (${N} drives each)`);
}
for (const [label, chooser] of [['random masher', chooseRandom], ['coverage reader', chooseSmart], ['always-deepest', chooseDeepest]]) {
  const m = measure(label, chooser, games);
  const o = m.stats.byOutcome, pl = m.stats.plays;
  const pct = (k) => ((o[k] || 0) / pl * 100).toFixed(1);
  console.log(
    `${label.padEnd(16)} win% ${m.winPct.toFixed(1).padStart(5)}  (W ${m.wins} / T ${m.ties} / L ${m.losses})  ` +
    `win+½tie ${m.winPlusHalfTie.toFixed(1)}  | avg ${m.avgPlayer.toFixed(1)}-${m.avgCpu.toFixed(1)}  ` +
    `| play mix: cmp ${pct('completion')} inc ${pct('incomplete')} pbu ${pct('pbu')} int ${pct('interception')} sack ${pct('sack')}`
  );
}
