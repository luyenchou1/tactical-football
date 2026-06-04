// Zero-dependency test harness for the pure matchup engine (sim.js).
//   cd web && npm test        (or: node --test)
//
// Two jobs:
//   1. Invariants — every route × coverage × leverage produces a well-formed
//      result (no throws, valid outcome, sane yards, unique chain keys).
//   2. Calibration snapshots — seeded distributions that guard against JS
//      self-regression AND JS↔Python drift. When a balance change deliberately
//      moves a number, re-baseline the band here (that's the point — it forces
//      the change to be acknowledged).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sim = require('./sim.js');                 // sim.js exports a CommonJS module
const P = Sim.DEFAULT_PLAYERS;
const OUTCOMES = ['completion', 'incomplete', 'pbu', 'interception', 'sack'];

// deterministic RNG so seeded snapshots are stable across runs
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cmpPct(opts, N) {
  const orig = Math.random; Math.random = mulberry32(0x1a2b3c4d);
  try {
    let c = 0;
    for (let i = 0; i < N; i++) if (Sim.resolvePlay(opts).outcome === 'completion') c++;
    return (c / N) * 100;
  } finally { Math.random = orig; }
}
function ratePct(opts, outcome, N) {
  const orig = Math.random; Math.random = mulberry32(0x1a2b3c4d);
  try {
    let c = 0;
    for (let i = 0; i < N; i++) if (Sim.resolvePlay(opts).outcome === outcome) c++;
    return (c / N) * 100;
  } finally { Math.random = orig; }
}
const BASE = { receiver: P.slot, defender: P.nb, lb: P.mlb, qb: P.qb };

test('invariants: every route × coverage × leverage is well-formed', () => {
  for (const route of Object.keys(Sim.ROUTES))
    for (const coverage of ['man', 'zone', 'blitz'])
      for (const leverage of ['inside', 'outside'])
        for (let i = 0; i < 150; i++) {
          const r = Sim.resolvePlay({ route, coverage, leverage, receiver: P.slot, defender: P.nb, lb: P.mlb, qb: P.qb });
          assert.ok(OUTCOMES.includes(r.outcome), `bad outcome "${r.outcome}" for ${route}/${coverage}/${leverage}`);
          if (r.outcome === 'completion') assert.ok(r.yards >= 0, 'completion yards >= 0');
          else if (r.outcome === 'interception' || r.outcome === 'sack') assert.ok(r.yards <= 0, `${r.outcome} yards <= 0`);
          else assert.equal(r.yards, 0, `${r.outcome} yards must be 0`);
          const keys = r.chain.map((s) => s.key);
          assert.equal(new Set(keys).size, keys.length, `chain keys must be unique: ${keys.join(',')}`);
          assert.ok(r.meta && typeof r.meta.sep === 'number', 'meta is present');
        }
});

// Calibration band — Python target for default slot WR vs avg nickel is ~80%.
test('calibration: default slant vs man/outside stays in band [76, 84]', () => {
  const pct = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'outside' }, 6000);
  assert.ok(pct >= 76 && pct <= 84, `slant/man/outside ${pct.toFixed(1)}% out of band [76, 84]`);
});

// The read must matter: beating leverage should clearly beat throwing into it.
test('calibration: leverage swing is real (beat − into ≥ 8 pts)', () => {
  const beat = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'outside' }, 6000);
  const into = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'inside' }, 6000);
  assert.ok(beat - into >= 8, `leverage swing only ${(beat - into).toFixed(1)}pp (beat ${beat.toFixed(1)} / into ${into.toFixed(1)})`);
});

// Guards the risk axis (pass rush + forced-read INT). Without these, the whole
// just-shipped feature could be reverted with completion% unchanged and tests green.
test('risk axis: pass-rush sacks and forced-read INTs stay calibrated', () => {
  const N = 6000;
  const digBlitzSack = ratePct({ ...BASE, route: 'dig', coverage: 'blitz', leverage: 'outside' }, 'sack', N);
  const slantBlitzSack = ratePct({ ...BASE, route: 'slant', coverage: 'blitz', leverage: 'outside' }, 'sack', N);
  const digIntoInt = ratePct({ ...BASE, route: 'dig', coverage: 'man', leverage: 'inside' }, 'interception', N);
  const slantBeatInt = ratePct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'outside' }, 'interception', N);
  assert.ok(digBlitzSack >= 14 && digBlitzSack <= 24, `dig/blitz sack ${digBlitzSack.toFixed(1)}% out of [14, 24]`);
  assert.ok(slantBlitzSack >= 4 && slantBlitzSack <= 12, `slant/blitz sack ${slantBlitzSack.toFixed(1)}% out of [4, 12]`);
  assert.ok(digIntoInt >= 0.8 && digIntoInt <= 2.6, `dig/man/inside INT ${digIntoInt.toFixed(2)}% out of [0.8, 2.6]`);
  assert.ok(slantBeatInt <= 0.9, `slant/man/outside INT ${slantBeatInt.toFixed(2)}% should be <= 0.9`);
  // direction (seed-robust): depth is sacked more vs blitz; forcing into coverage is picked more
  assert.ok(digBlitzSack > slantBlitzSack + 5, 'deep routes must be sacked more than quick vs blitz');
  assert.ok(digIntoInt > slantBeatInt, 'forcing a deep route into coverage must be picked more than a good read');
});
