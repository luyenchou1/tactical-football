// Variant pickers to probe what a coverage-reader can actually achieve,
// and to sanity-check that the headline 'smart' number isn't a tie-break artifact.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Sim = require('./sim.js');
const P = Sim.DEFAULT_PLAYERS;

const ELIGIBLE = [
  { key: 'x', defKey: 'cbX' }, { key: 'z', defKey: 'cbZ' }, { key: 'slot', defKey: 'nb' },
  { key: 'te', defKey: 'ss' }, { key: 'rb', defKey: 'mlb' },
];
const PLAYS = [
  { id: 'slants',  routes: { x: 'slant', z: 'slant', slot: 'slant', te: 'drag', rb: 'flat' } },
  { id: 'mesh',    routes: { x: 'dig',   z: 'drag',  slot: 'drag',  te: 'curl', rb: 'flat' } },
  { id: 'stick',   routes: { x: 'out',   z: 'curl',  slot: 'hitch', te: 'dig',  rb: 'flat' } },
  { id: 'spacing', routes: { x: 'hitch', z: 'out',   slot: 'curl',  te: 'drag', rb: 'flat' } },
];
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
const STATUS_RANK = { good: 2, neutral: 1, bad: 0 };

function options(coverage, levMap) {
  const opts = [];
  for (const pl of PLAYS) for (const e of ELIGIBLE) {
    const route = pl.routes[e.key];
    const lev = coverage === 'zone' ? null : levMap[e.defKey];
    opts.push({ pl, e, route, lev, status: Sim.readStatus(route, coverage, lev) });
  }
  return opts;
}

// Smart-deep: best read, tie-break DEEPER (the shipped headline picker).
function smartDeep(opts) {
  let best = opts[0];
  for (const o of opts) {
    const a = STATUS_RANK[o.status], b = STATUS_RANK[best.status];
    if (a > b || (a === b && Sim.routeDepth(o.route) > Sim.routeDepth(best.route))) best = o;
  }
  return best;
}
// Smart-safe: best read, tie-break SHALLOWER (quicker = fewer sacks).
function smartSafe(opts) {
  let best = opts[0];
  for (const o of opts) {
    const a = STATUS_RANK[o.status], b = STATUS_RANK[best.status];
    if (a > b || (a === b && Sim.routeDepth(o.route) < Sim.routeDepth(best.route))) best = o;
  }
  return best;
}
// Oracle: precomputed per-(route,coverage,leverage) EV; pick max-EV option each play.
// This is the strongest legal "reader" given the engine — upper bound on win%.
const EV = {};
function evKey(route, coverage, lev) { return route + '|' + coverage + '|' + (lev || '-'); }
function buildEV(N) {
  for (const cov of ['man', 'zone', 'blitz']) {
    for (const route of Object.keys(Sim.ROUTES)) {
      const levs = cov === 'zone' ? [null] : ['inside', 'outside'];
      for (const lev of levs) {
        // EV per the receiver/defender that actually runs this route in some play.
        // Use the slot/nb default matchup as a stable proxy (same as engine calibration).
        let tot = 0;
        for (let i = 0; i < N; i++) {
          const r = Sim.resolvePlay({ route, coverage: cov, leverage: lev, receiver: P.slot, defender: P.nb, lb: P.mlb, qb: P.qb });
          tot += r.yards | 0;
        }
        EV[evKey(route, cov, lev)] = tot / N;
      }
    }
  }
}
function oracle(opts, coverage) {
  let best = opts[0], bestEV = -1e9;
  for (const o of opts) {
    const ev = EV[evKey(o.route, coverage, o.lev)];
    if (ev > bestEV) { bestEV = ev; best = o; }
  }
  return best;
}

function advance(state, result) {
  state.plays += 1;
  if (result.outcome === 'interception') { state.over = true; return; }
  const gain = result.yards | 0;
  state.ballOn = Math.max(1, state.ballOn + gain); state.distance -= gain;
  if (state.ballOn >= 100) { state.score += 7; state.over = true; }
  else if (gain > 0 && state.distance <= 0) { state.down = 1; state.distance = (100 - state.ballOn <= 10) ? (100 - state.ballOn) : 10; }
  else { state.down += 1; if (state.down > 4) state.over = true; }
}
function playDrive(chooser) {
  const state = { ballOn: 25, down: 1, distance: 10, plays: 0, over: false, score: 0 };
  let g = 0;
  while (!state.over && g++ < 200) {
    const cr = Math.random();
    const coverage = cr < 0.35 ? 'zone' : cr < 0.55 ? 'blitz' : 'man';
    const levMap = {}; for (const k of ['cbX','cbZ','nb','ss','mlb']) levMap[k] = Math.random() < 0.5 ? 'outside' : 'inside';
    const opts = options(coverage, levMap);
    const choice = chooser(opts, coverage);
    const e = choice.e;
    const result = Sim.resolvePlay({ route: choice.route, coverage, leverage: levMap[e.defKey], receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb });
    advance(state, result);
  }
  return state.score;
}
function cpu() { const r = Math.random(); return r < 0.46 ? 7 : r < 0.72 ? 3 : 0; }
function playGame(ch) { let p = 0, c = 0; for (let d = 0; d < 5; d++) { p += playDrive(ch); c += cpu(); } return { win: p > c, tie: p === c, p, c }; }
function measure(name, ch, games) {
  let w = 0, t = 0, tp = 0, tc = 0;
  for (let i = 0; i < games; i++) { const r = playGame(ch); if (r.win) w++; else if (r.tie) t++; tp += r.p; tc += r.c; }
  console.log(`${name.padEnd(22)} win% ${(w/games*100).toFixed(1).padStart(5)}  win+½tie ${((w+0.5*t)/games*100).toFixed(1)}  avg ${(tp/games).toFixed(1)}-${(tc/games).toFixed(1)}`);
}

const games = Number(process.argv[2] || 20000);
buildEV(40000);
console.log(`Reader variants — ${games} games each`);
console.log('EV table (yards) by route|cov|lev (slot vs nb):');
for (const cov of ['man','zone','blitz']) {
  const row = Object.keys(Sim.ROUTES).map(rt => {
    const lev = cov === 'zone' ? null : 'best'; // show the better leverage for man/blitz
    if (cov === 'zone') return `${rt} ${EV[evKey(rt,cov,null)].toFixed(1)}`;
    const a = EV[evKey(rt,cov,'inside')], b = EV[evKey(rt,cov,'outside')];
    return `${rt} ${Math.max(a,b).toFixed(1)}`;
  }).join('  ');
  console.log(`  ${cov.padEnd(6)} ${row}`);
}
console.log('-'.repeat(80));
measure('smart-deep (shipped)', smartDeep, games);
measure('smart-safe', smartSafe, games);
measure('oracle (max-EV)', oracle, games);
