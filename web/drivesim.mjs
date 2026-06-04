// drivesim.mjs — drive-level balance simulator for Tactical Football.
// Requires the REAL engine (web/sim.js). Models a 5-drive game:
//   - each player drive: pick-play -> pick-target -> snap, resolved by Sim.resolvePlay
//   - drive ends on TD / turnover-on-downs / INT (advanceDown logic mirrored from game.js)
//   - between player drives, an abstracted CPU possession: TD 46% / FG 26% / punt 28%
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
  // best read; tie-break by deeper route (more reward on a safe read)
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

// CPU possession (mirror game.js showCpuPossession): TD 46% / FG 26% / punt 28%.
function cpuPossession() {
  const roll = Math.random();
  if (roll < 0.46) return 7;
  if (roll < 0.72) return 3;
  return 0;
}

const DRIVES_PER_GAME = 5;

// Play one full game; return { win, tie, loss, playerScore, cpuScore }.
function playGame(chooser, stats) {
  let player = 0, cpu = 0;
  for (let d = 0; d < DRIVES_PER_GAME; d++) {
    player += playDrive(chooser, stats);
    cpu += cpuPossession();        // one CPU possession per player drive (game.js: cpu turn after each drive)
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

console.log(`Drive-level win rates — ${games} games each — CPU TD46/FG26/punt28, def zone.35/blitz.20/man.45`);
console.log('='.repeat(96));
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
