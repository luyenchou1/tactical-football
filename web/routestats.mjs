// Per-route EV / sack% / INT% for good vs bad reads, measured from the REAL engine.
// "good read" = beat leverage (man) or zone-beater (zone) or quick (blitz);
// "bad read"  = into leverage / zone-jumped / slow-into-blitz.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Sim = require('./sim.js');
const P = Sim.DEFAULT_PLAYERS;
const N = Number(process.argv[2] || 200000);

function run(route, coverage, leverage) {
  let cmp = 0, intc = 0, sack = 0, pbu = 0, inc = 0, ev = 0, yds = 0;
  for (let i = 0; i < N; i++) {
    const r = Sim.resolvePlay({ route, coverage, leverage, receiver: P.slot, defender: P.nb, lb: P.mlb, qb: P.qb });
    ev += r.yards | 0;
    if (r.outcome === 'completion') { cmp++; yds += r.yards | 0; }
    else if (r.outcome === 'interception') intc++;
    else if (r.outcome === 'sack') sack++;
    else if (r.outcome === 'pbu') pbu++;
    else inc++;
  }
  return { route, coverage, leverage, cmp: cmp/N*100, int: intc/N*100, sack: sack/N*100, pbu: pbu/N*100, ev: ev/N, ypa: yds/N };
}
function fmt(s) {
  return `${(s.route+'/'+s.coverage+(s.leverage?'/'+s.leverage:'')).padEnd(22)} cmp ${s.cmp.toFixed(1).padStart(5)}  int ${s.int.toFixed(2).padStart(4)}  sack ${s.sack.toFixed(1).padStart(4)}  pbu ${s.pbu.toFixed(2).padStart(4)}  EV ${s.ev.toFixed(2).padStart(5)}`;
}

const ROUTES = Sim.ROUTES;
console.log(`Per-route stats — ${N} plays each (slot WR vs nickel, MLB lane, default QB)`);
console.log('='.repeat(96));

console.log('\n## MAN — good read (beat leverage) vs bad read (into leverage)');
for (const route of Object.keys(ROUTES)) {
  const brk = ROUTES[route].brk;
  if (!brk) { // neutral route — leverage doesn't matter
    console.log(fmt(run(route, 'man', 'outside')) + '   (neutral)');
    continue;
  }
  const good = brk === 'in' ? 'outside' : 'inside';
  const bad  = brk === 'in' ? 'inside'  : 'outside';
  console.log('GOOD ' + fmt(run(route, 'man', good)));
  console.log('BAD  ' + fmt(run(route, 'man', bad)));
}

console.log('\n## ZONE (Cover 3)');
for (const route of Object.keys(ROUTES)) console.log(fmt(run(route, 'zone', 'outside')));

console.log('\n## BLITZ — sack pricing by route speed (tt)');
for (const route of Object.keys(ROUTES)) {
  const s = run(route, 'blitz', 'outside');
  console.log(fmt(s) + `   tt=${ROUTES[route].tt}s`);
}

console.log('\n## CLAIM 3 focus — forcing a DEEP route into coverage vs a good read');
console.log('dig into man/inside (bad, deep):');
console.log('  ' + fmt(run('dig', 'man', 'inside')));
console.log('dig vs man/outside (good, deep):');
console.log('  ' + fmt(run('dig', 'man', 'outside')));
console.log('out into man/inside (bad):');
console.log('  ' + fmt(run('out', 'man', 'inside')));
console.log('out vs man/outside (good):');
console.log('  ' + fmt(run('out', 'man', 'outside')));
console.log('out into zone (jumped by curl-flat):');
console.log('  ' + fmt(run('out', 'zone', 'outside')));
