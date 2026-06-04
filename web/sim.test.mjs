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
test('calibration: default slant vs man/outside stays in band [74, 88]', () => {
  const pct = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'outside' }, 6000);
  assert.ok(pct >= 74 && pct <= 88, `slant/man/outside ${pct.toFixed(1)}% out of band [74, 88]`);
});

// The read must matter: beating leverage should clearly beat throwing into it.
test('calibration: leverage swing is real (beat − into ≥ 8 pts)', () => {
  const beat = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'outside' }, 6000);
  const into = cmpPct({ ...BASE, route: 'slant', coverage: 'man', leverage: 'inside' }, 6000);
  assert.ok(beat - into >= 8, `leverage swing only ${(beat - into).toFixed(1)}pp (beat ${beat.toFixed(1)} / into ${into.toFixed(1)})`);
});
