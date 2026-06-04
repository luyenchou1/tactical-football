// game.js — DOM, rendering, interaction, and the tick-reveal animation.
// All matchup math lives in sim.js (window.Sim). This file turns a resolved
// play into pixels and runs the pre-snap → snap → breakdown loop.
//
// Pre-snap flow: the defense calls man/zone (shown), you pick a PLAY (which
// assigns every receiver a route), then pick the TARGET receiver, then snap.

(function () {
  'use strict';

  const CENTER = 26.6;

  // ---------- field coordinate system ----------
  const FIELD = { minY: -9, maxY: 21, width: 53.3 };
  function toLeft(x) { return (x / FIELD.width) * 100; }
  function toTop(y) { return ((FIELD.maxY - y) / (FIELD.maxY - FIELD.minY)) * 100; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- formation (base positions in yard space) ----------
  const FORMATION = [
    { id: 'C',  team: 'off', num: 55, x: 26.6, y: 0 },
    { id: 'LG', team: 'off', num: 66, x: 23.8, y: 0 },
    { id: 'RG', team: 'off', num: 67, x: 29.4, y: 0 },
    { id: 'LT', team: 'off', num: 73, x: 21.0, y: 0 },
    { id: 'RT', team: 'off', num: 76, x: 32.2, y: 0 },
    { id: 'QB', team: 'off', num: 9,  x: 26.6, y: -5, simKey: 'qb' },
    { id: 'RB', team: 'off', num: 28, x: 23.2, y: -5, simKey: 'rb' },
    { id: 'TE', team: 'off', num: 87, x: 18.4, y: 0, simKey: 'te' },
    { id: 'X',  team: 'off', num: 80, x: 5.0,  y: 0, simKey: 'x' },
    { id: 'Z',  team: 'off', num: 18, x: 48.0, y: 0, simKey: 'z' },
    { id: 'SLOT', team: 'off', num: 11, x: 38.0, y: 0, simKey: 'slot' },
    { id: 'DE_L', team: 'def', num: 91, x: 21.0, y: 2 },
    { id: 'DT_L', team: 'def', num: 94, x: 24.6, y: 2 },
    { id: 'DT_R', team: 'def', num: 98, x: 28.6, y: 2 },
    { id: 'DE_R', team: 'def', num: 56, x: 32.2, y: 2 },
    { id: 'MLB', team: 'def', num: 54, x: 27.0, y: 5.5, simKey: 'mlb' },
    { id: 'SLB', team: 'def', num: 50, x: 33.5, y: 6.0 },
    { id: 'CB_X', team: 'def', num: 24, x: 6.0,  y: 5.0, simKey: 'cbX' },
    { id: 'CB_Z', team: 'def', num: 21, x: 47.0, y: 5.0, simKey: 'cbZ' },
    { id: 'NB',   team: 'def', num: 27, x: 40.0, y: 4.0, simKey: 'nb' },
    { id: 'SS',   team: 'def', num: 32, x: 18.4, y: 4.5, simKey: 'ss' },
    { id: 'FS',   team: 'def', num: 31, x: 27.0, y: 14.0, simKey: 'fs' },
  ];
  const baseX = {}; FORMATION.forEach(function (f) { baseX[f.id] = f.x; });

  // Eligible receivers + their man defender. mlb is also the lane LB.
  const ELIGIBLE = [
    { key: 'x',    chip: 'X',    pos: 'X',    defKey: 'cbX', defChip: 'CB_X' },
    { key: 'z',    chip: 'Z',    pos: 'Z',    defKey: 'cbZ', defChip: 'CB_Z' },
    { key: 'slot', chip: 'SLOT', pos: 'Slot', defKey: 'nb',  defChip: 'NB' },
    { key: 'te',   chip: 'TE',   pos: 'TE',   defKey: 'ss',  defChip: 'SS' },
    { key: 'rb',   chip: 'RB',   pos: 'RB',   defKey: 'mlb', defChip: 'MLB' },
  ];
  const elgByKey = {}; ELIGIBLE.forEach(function (e) { elgByKey[e.key] = e; });
  // man defenders we visibly shade by leverage (skip MLB — it keys the RB underneath)
  const MAN_SHADE = ELIGIBLE.filter(function (e) { return e.key !== 'rb'; });

  // ---------- playbook ----------
  const PLAYS = [
    { id: 'slants',  name: 'Quick Slants', tag: 'man-beater',
      routes: { x: 'slant', z: 'slant', slot: 'slant', te: 'drag', rb: 'flat' } },
    { id: 'mesh',    name: 'Mesh', tag: 'man-beater',
      routes: { x: 'dig', z: 'drag', slot: 'drag', te: 'curl', rb: 'flat' } },
    { id: 'stick',   name: 'Stick', tag: 'zone-beater',
      routes: { x: 'out', z: 'curl', slot: 'hitch', te: 'dig', rb: 'flat' } },
    { id: 'spacing', name: 'Spacing', tag: 'zone-beater',
      routes: { x: 'hitch', z: 'out', slot: 'curl', te: 'drag', rb: 'flat' } },
  ];

  // ---------- route geometry (parametric: applied to each receiver's start) ----------
  function routePath(x, y, route) {
    const inX = x < CENTER ? 1 : -1;   // toward the middle of the field
    const out = -inX;                  // toward the nearest sideline
    switch (route) {
      case 'slant': return [[x, y], [x, y + 1.5], [x + inX * 2, y + 3.5], [x + inX * 4, y + 5], [x + inX * 4, y + 5], [x + inX * 7, y + 8]];
      case 'hitch': return [[x, y], [x, y + 3.5], [x, y + 5], [x, y + 4], [x, y + 4], [x, y + 4.5]];
      case 'out':   return [[x, y], [x, y + 3], [x, y + 5.5], [x + out * 4, y + 6], [x + out * 4, y + 6], [x + out * 7, y + 6.5]];
      case 'drag':  return [[x, y], [x + inX * 2, y + 1], [x + inX * 5, y + 2.5], [x + inX * 9, y + 3.5], [x + inX * 9, y + 3.5], [x + inX * 13, y + 4.5]];
      case 'dig':   return [[x, y], [x, y + 4], [x, y + 8], [x + inX * 4, y + 10], [x + inX * 4, y + 10], [x + inX * 8, y + 11]];
      case 'curl':  return [[x, y], [x, y + 5], [x, y + 9], [x, y + 8], [x, y + 8], [x, y + 8]];
      case 'flat':  return [[x, y], [x + out * 2, y + 1], [x + out * 4, y + 1.5], [x + out * 6, y + 2], [x + out * 6, y + 2], [x + out * 9, y + 2.5]];
      default:      return [[x, y], [x, y + 2], [x, y + 4], [x, y + 5], [x, y + 5], [x, y + 6]];
    }
  }

  const P = Sim.DEFAULT_PLAYERS;

  // ---------- DOM refs ----------
  const fieldEl = document.getElementById('field');
  const routesSvg = document.getElementById('routes');
  const ballEl = document.getElementById('ball');
  const panel = {
    presnap: document.getElementById('presnap'),
    animating: document.getElementById('animating'),
    postplay: document.getElementById('postplay'),
    cpu: document.getElementById('cpu'),
    gameover: document.getElementById('gameover'),
  };
  const tickCaption = document.getElementById('tick-caption');
  const resultLine = document.getElementById('result-line');
  const breakdownEl = document.getElementById('breakdown');
  const snapBtn = document.getElementById('snap-btn');
  const nextBtn = document.getElementById('next-btn');
  const newGameBtn = document.getElementById('new-game-btn');
  const cpuContinueBtn = document.getElementById('cpu-continue');
  const hintBtn = document.getElementById('hint-btn');
  const hintBox = document.getElementById('hint-box');
  const readText = document.getElementById('read-text');
  const readBanner = document.getElementById('read-banner');
  const driveBanner = document.getElementById('drive-banner');
  const endzoneEl = document.getElementById('endzone');
  const playPickerEl = document.getElementById('play-picker');
  const targetPickerEl = document.getElementById('target-picker');
  const targetLabel = document.getElementById('target-label');

  // ---------- game state ----------
  const chips = {};
  let coverage = 'man';
  const levMap = {};                 // defKey -> 'inside' | 'outside' (man shade)
  let chosenPlay = null, chosenTarget = null;
  let down = 1, distance = 10, ballOn = 25;
  let score = 0;
  let drivePlays = 0, driveStartYard = 25;
  let driveOver = false, driveResult = null;   // 'td' | 'downs' | 'int'

  const DRIVES_PER_GAME = 5;
  let drivesPlayed = 0, tdCount = 0, gameOver = false;
  let cpuScore = 0;
  let bestScore = Number(localStorage.getItem('tf-best') || 0);
  const fastMode = /[?&]fast\b/.test(location.search);

  // ---------- chip rendering ----------
  function buildChips() {
    FORMATION.forEach(function (p) {
      const el = document.createElement('div');
      el.className = 'chip ' + p.team + (p.simKey ? ' key' : '');
      el.textContent = p.num;
      el.addEventListener('click', function (e) { e.stopPropagation(); showCard(p); });
      fieldEl.appendChild(el);
      chips[p.id] = el;
    });
    addFieldLine('los', 0);
    addFieldLine('first', distance);
  }

  function addFieldLine(kind, yd) {
    const line = document.createElement('div');
    line.className = 'fieldline ' + kind;
    line.dataset.kind = kind;
    line.style.top = toTop(yd) + '%';
    fieldEl.appendChild(line);
  }

  function placeChip(id, x, y) {
    const el = chips[id];
    el.style.left = toLeft(x) + '%';
    el.style.top = toTop(y) + '%';
  }

  function resetFormation() {
    const shade = {};
    if (coverage === 'man') {
      MAN_SHADE.forEach(function (e) {
        const rx = baseX[e.chip];
        const sideline = rx < CENTER ? -1 : 1;
        const dir = (levMap[e.defKey] === 'outside') ? sideline : -sideline;
        shade[e.defChip] = rx + dir * 2.8;
      });
    }
    FORMATION.forEach(function (p) {
      placeChip(p.id, shade[p.id] !== undefined ? shade[p.id] : p.x, p.y);
      chips[p.id].classList.remove('primary');
    });
    ballEl.style.opacity = '0';
    placeBall(26.6, 0);
  }

  function placeBall(x, y) {
    ballEl.style.left = toLeft(x) + '%';
    ballEl.style.top = toTop(y) + '%';
  }

  // ---------- route preview (SVG) ----------
  function clearRoutes() {
    routesSvg.querySelectorAll('polyline').forEach(function (n) { n.remove(); });
  }
  function drawPolyline(pts, color, faint) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    el.setAttribute('points', pts.map(function (p) { return toLeft(p[0]) + ',' + toTop(p[1]); }).join(' '));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', faint ? '0.8' : '1.6');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    if (faint) { el.setAttribute('opacity', '0.5'); el.setAttribute('marker-end', 'url(#arrow-faint)'); el.style.color = 'rgba(255,255,255,0.35)'; }
    else { el.setAttribute('marker-end', 'url(#arrow)'); el.style.color = color; }
    routesSvg.appendChild(el);
  }
  function drawPlayRoutes() {
    clearRoutes();
    if (!chosenPlay) return;
    ELIGIBLE.forEach(function (e) {
      const pts = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, chosenPlay.routes[e.key]);
      const isTgt = (e.key === chosenTarget);
      let color = 'rgba(255,255,255,0.45)';
      if (isTgt) {
        const lev = coverage === 'zone' ? null : levMap[e.defKey];
        const q = Sim.readStatus(chosenPlay.routes[e.key], coverage, lev);
        color = q === 'good' ? '#46c46a' : q === 'bad' ? '#e8543e' : '#ffcf33';
      }
      drawPolyline(pts, color, !isTgt);
    });
  }

  // ---------- player stat card ----------
  const cardLayer = document.getElementById('card-layer');
  const cardEl = document.getElementById('card');
  function ratingClass(v) { return v >= 80 ? 'hi' : v >= 70 ? 'mid' : 'lo'; }
  function starStr(avg) {
    const n = avg >= 90 ? 5 : avg >= 80 ? 4 : avg >= 70 ? 3 : avg >= 60 ? 2 : 1;
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }
  function showCard(p) {
    const sim = p.simKey ? P[p.simKey] : null;
    const name = sim ? sim.name : p.id.replace('_', ' ');
    const ratings = sim ? sim.r : genericRatings(p);
    const keys = Object.keys(ratings).filter(function (k) { return k !== 'STA'; });
    const avg = Math.round(keys.reduce(function (a, k) { return a + ratings[k]; }, 0) / keys.length);
    const color = p.team === 'off' ? 'var(--off)' : 'var(--def)';
    let grid = '';
    keys.forEach(function (k) {
      grid += '<div class="stat"><span class="k">' + k + '</span>' +
              '<span class="v ' + ratingClass(ratings[k]) + '">' + ratings[k] + '</span></div>';
    });
    cardEl.innerHTML =
      '<div class="card-top"><div class="card-num" style="background:' + color + '">' + p.num + '</div>' +
      '<div><div class="card-name">' + name + '</div><div class="card-pos">' + posName(p) + '</div></div></div>' +
      '<div class="card-stars">' + starStr(avg) + '</div>' +
      '<div class="card-grid">' + grid + '</div>' +
      '<button class="card-close">Close</button>';
    cardEl.querySelector('.card-close').addEventListener('click', hideCard);
    cardLayer.classList.remove('hidden');
  }
  function hideCard() { cardLayer.classList.add('hidden'); }
  cardLayer.addEventListener('click', function (e) { if (e.target === cardLayer) hideCard(); });
  function posName(p) {
    const map = { QB: 'Quarterback', SLOT: 'Slot WR', NB: 'Nickel CB', MLB: 'Linebacker',
                  FS: 'Free Safety', X: 'Wide Receiver', Z: 'Wide Receiver', TE: 'Tight End',
                  RB: 'Running Back', SS: 'Strong Safety', CB_X: 'Cornerback', CB_Z: 'Cornerback' };
    return map[p.id] || (p.team === 'off' ? 'Offense' : 'Defense');
  }
  function genericRatings(p) {
    const seed = p.num, base = p.team === 'off' ? 72 : 74;
    function r(off) { return Math.max(55, Math.min(92, base + ((seed * (off + 3)) % 17) - 8)); }
    if (p.team === 'off') return { STR: r(1), RBK: r(2), PBK: r(3), AWR: r(4), AGI: r(5) };
    return { TKL: r(1), PRS: r(2), SPD: r(3), AWR: r(4), STR: r(5) };
  }

  // ---------- the tick reveal ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, fastMode ? 0 : ms); }); }
  function buzz(p) { if (p && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }
  function popIn(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  function buildScript(result) {
    const meta = result.meta;
    const sep = meta.sep, caught = meta.caught, intercepted = meta.intercepted, inLane = meta.undercut;
    const paths = {};
    ELIGIBLE.forEach(function (e) {
      paths[e.chip] = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, chosenPlay.routes[e.key]);
    });
    const tgt = elgByKey[chosenTarget];
    const catchPt = paths[tgt.chip][3];
    // Who actually plays the ball: the MLB when it jumps the lane (or covers the RB underneath),
    // otherwise the target's own man defender. Drives the INT/PBU ball path + MLB converge.
    const mlbIsContester = inLane || (chosenTarget === 'rb' && sep === 0);
    const sacked = meta.sacked;
    function qbAt(t) { return t < 3 ? [26.6, -5] : [26.6, -5 - (t - 2) * 0.7]; }   // driven back when sacked

    function defAt(e, t) {
      const rp = paths[e.chip][t];
      if (coverage === 'zone') {                       // hold the zone, slight drop
        return [baseX[e.defChip], FORMATION.find(function (f) { return f.id === e.defChip; }).y + Math.min(t * 0.4, 1.6)];
      }
      const beat = (e.key === chosenTarget ? sep * 0.8 : 0.4);
      const sideline = baseX[e.chip] < CENTER ? -1 : 1;
      return [rp[0] + sideline * Math.min(beat, 2), rp[1] - (0.5 + beat * 0.3)];
    }
    function mlbAt(t) {
      if (mlbIsContester && t >= 3) return [catchPt[0] + (catchPt[0] < CENTER ? 1 : -1), catchPt[1] - 0.6];
      return [27 + t * 0.2, 5.5 + t * 0.5];
    }
    function ballAt(t) {
      if (t <= 2) return [26.6, -3];
      if (sacked) return qbAt(t);
      if (t === 3 || t === 4) return catchPt;
      if (intercepted) return mlbIsContester ? mlbAt(5) : defAt(tgt, 5);
      if (caught) return paths[tgt.chip][5];
      return [catchPt[0], catchPt[1] - 1];
    }
    const throwQ = (result.chain.find(function (c) { return c.key === 'throw'; }) || { value: '' }).value;
    const captions = sacked
      ? ['Snap…', 'Routes develop', 'Pocket collapsing…', 'SACK!', 'Brought down', '']
      : [
        'Snap…',
        'Routes develop',
        sep >= 2 ? tgt.pos + ' open!' : sep === 1 ? tgt.pos + ' a step open' : tgt.pos + ' covered',
        'Throw to ' + tgt.pos + ' — ' + throwQ,
        caught ? 'Caught!' : intercepted ? 'Picked off!' : 'Incomplete',
        result.outcome === 'completion' ? 'Tackled after the catch' : '',
      ];
    return { paths: paths, defAt: defAt, mlbAt: mlbAt, ballAt: ballAt, qbAt: qbAt, captions: captions, caught: caught, intercepted: intercepted, sacked: sacked };
  }

  async function playReveal(result) {
    const sc = buildScript(result);
    setStage('animating');
    clearRoutes();
    ballEl.style.opacity = '1';
    for (let t = 0; t < 6; t++) {
      ELIGIBLE.forEach(function (e) {
        placeChip(e.chip, sc.paths[e.chip][t][0], sc.paths[e.chip][t][1]);
        if (e.key !== 'rb') { const d = sc.defAt(e, t); placeChip(e.defChip, d[0], d[1]); }
      });
      placeChip('MLB', sc.mlbAt(t)[0], sc.mlbAt(t)[1]);
      if (sc.sacked) {
        placeChip('QB', sc.qbAt(t)[0], sc.qbAt(t)[1]);
        placeChip('DE_R', 32.2 + (26.6 - 32.2) * (t / 5), 2 + (-5 - 2) * (t / 5));   // edge rusher collapses the pocket
      }
      const b = sc.ballAt(t);
      placeBall(b[0], b[1]);
      if (t === 5 && !sc.caught && !sc.intercepted && !sc.sacked) ballEl.style.opacity = '0';
      if (sc.captions[t]) tickCaption.textContent = sc.captions[t];
      await sleep(t === 0 ? 450 : 680);
    }
    await sleep(420);
    showResult(result);
  }

  // ---------- result / breakdown ----------
  function showResult(result) {
    setStage('postplay');
    advanceDown(result);

    const o = result.outcome;
    let cls = 'neutral', txt = '';
    if (o === 'completion') { cls = 'good'; txt = 'Completion +' + result.yards; }
    else if (o === 'interception') { cls = 'bad'; txt = 'INTERCEPTED'; }
    else if (o === 'pbu') { cls = 'bad'; txt = 'Pass broken up'; }
    else if (o === 'sack') { cls = 'bad'; txt = 'Sack ' + result.yards; }
    else { cls = 'neutral'; txt = 'Incomplete'; }
    resultLine.className = cls;
    resultLine.textContent = txt;
    popIn(resultLine);
    buzz(driveResult === 'td' ? [40, 30, 70] : (o === 'interception' || o === 'sack') ? [70] : o === 'completion' ? 12 : 0);

    if (driveOver) {
      if (driveResult === 'td')         { driveBanner.className = 'td';       driveBanner.textContent = '🏈 TOUCHDOWN  +7'; }
      else if (driveResult === 'downs') { driveBanner.className = 'turnover'; driveBanner.textContent = 'Turnover on downs'; }
      else                              { driveBanner.className = 'turnover'; driveBanner.textContent = 'Intercepted — turnover'; }
      popIn(driveBanner);
      nextBtn.textContent = 'Next drive ›';
    } else {
      driveBanner.className = 'hidden';
      nextBtn.textContent = 'Next play ›';
    }

    breakdownEl.innerHTML = '';
    result.chain.forEach(function (step) {
      const row = document.createElement('div');
      row.className = 'bd-row';
      row.innerHTML =
        '<div class="bd-head"><span class="bd-dot ' + (step.status || 'neutral') + '"></span>' +
        '<span class="bd-label">' + step.label + '</span>' +
        '<span class="bd-value">' + (step.value || '') + '</span></div>' +
        (step.detail ? '<div class="bd-detail">' + step.detail + '</div>' : '') +
        (step.math ? '<div class="bd-math">' + step.math + '</div>' : '');
      row.addEventListener('click', function () { row.classList.toggle('open'); });
      breakdownEl.appendChild(row);
    });
  }

  // ---------- drive + scoreboard ----------
  function advanceDown(result) {
    drivePlays += 1;
    if (result.outcome === 'interception') { driveOver = true; driveResult = 'int'; updateHud(); return; }
    const gain = result.yards | 0;                 // negative on a sack
    ballOn = Math.max(1, ballOn + gain); distance -= gain;
    if (ballOn >= 100) { ballOn = 100; score += 7; tdCount += 1; driveOver = true; driveResult = 'td'; }
    else if (gain > 0 && distance <= 0) { down = 1; distance = (100 - ballOn <= 10) ? (100 - ballOn) : 10; }
    else { down += 1; if (down > 4) { driveOver = true; driveResult = 'downs'; } }
    updateHud();
  }

  function ordinal(d) { return ['', '1st', '2nd', '3rd', '4th'][d] || '4th'; }
  function fieldPos(y) {
    y = Math.round(y);
    if (y >= 100) return 'GOAL';
    if (y <= 0) return 'OWN 0';
    if (y === 50) return '50';
    return (y < 50 ? 'OWN ' + y : 'OPP ' + (100 - y));
  }
  function updateHud() {
    const goalToGo = (ballOn + distance) >= 100;
    document.getElementById('hud-down').textContent =
      (driveOver && driveResult === 'td') ? 'TD' : ordinal(down) + ' & ' + (goalToGo ? 'Goal' : Math.max(1, distance));
    document.getElementById('hud-spot').textContent = fieldPos(ballOn);
    document.getElementById('hud-score').textContent = score + '–' + cpuScore;
    document.getElementById('hud-drive').textContent = drivesPlayed + ' / ' + DRIVES_PER_GAME;
  }

  function setStage(name) {
    Object.keys(panel).forEach(function (k) { panel[k].classList.toggle('hidden', k !== name); });
  }

  // ---------- new drive / new play ----------
  function startDrive() {
    drivesPlayed += 1;
    ballOn = 25; down = 1; distance = 10; driveStartYard = 25;
    drivePlays = 0; driveOver = false; driveResult = null;
    newPlay();
  }
  function newGame() {
    score = 0; cpuScore = 0; tdCount = 0; drivesPlayed = 0; gameOver = false;
    startDrive();
  }
  function showCpuPossession() {
    const roll = Math.random();
    let pts, label;
    if (roll < 0.46)      { pts = 7; label = 'Touchdown'; }
    else if (roll < 0.72) { pts = 3; label = 'Field goal'; }
    else                  { pts = 0; label = 'Defense holds — punt'; }
    cpuScore += pts;
    const rl = document.getElementById('cpu-result');
    rl.textContent = pts > 0 ? (label + '  +' + pts) : label;
    rl.className = pts === 7 ? 'bad' : pts === 3 ? 'neutral' : 'good';
    document.getElementById('cpu-tally').textContent = 'You ' + score + ' · Opponent ' + cpuScore;
    updateHud();
    setStage('cpu');
  }
  function showGameOver() {
    gameOver = true;
    const isBest = score > bestScore;
    if (isBest) { bestScore = score; try { localStorage.setItem('tf-best', String(score)); } catch (e) {} }
    const result = score > cpuScore ? 'WIN' : score < cpuScore ? 'LOSS' : 'TIE';
    document.getElementById('go-score').textContent = score + '–' + cpuScore;
    const g = document.getElementById('go-grade');
    g.textContent = result;
    g.className = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'tie';
    document.getElementById('go-sub').textContent =
      'You vs Opponent · ' + tdCount + (tdCount === 1 ? ' TD' : ' TDs') + ' in ' + DRIVES_PER_GAME + ' drives';
    const best = document.getElementById('go-best');
    best.textContent = isBest ? ('New best!  ' + score + ' pts') : ('Best  ' + bestScore + ' pts');
    best.className = isBest ? 'go-best new' : 'go-best';
    popIn(g);
    buzz(result === 'WIN' ? [60, 40, 60, 40, 90] : result === 'LOSS' ? [120] : [40]);
    setStage('gameover');
  }

  function newPlay() {
    const cr = Math.random();
    coverage = cr < 0.35 ? 'zone' : cr < 0.55 ? 'blitz' : 'man';   // man 0.45 / zone 0.35 / blitz 0.20
    ['cbX', 'cbZ', 'nb', 'ss', 'mlb'].forEach(function (k) { levMap[k] = Math.random() < 0.5 ? 'outside' : 'inside'; });
    chosenPlay = null; chosenTarget = null;
    updateReadBanner();
    renderPlayPicker();
    snapBtn.disabled = true;
    hintBox.classList.add('hidden');
    hintBtn.setAttribute('aria-pressed', 'false');
    updateHint();
    resetFormation();
    updateFieldLines();
    updateHud();
    clearRoutes();
    setStage('presnap');
  }

  function updateFieldLines() {
    const goalToGo = (ballOn + distance) >= 100;
    const fl = fieldEl.querySelector('.fieldline.first');
    if (fl) {
      fl.style.top = toTop(goalToGo ? (100 - ballOn) : distance) + '%';
      fl.classList.toggle('goal', goalToGo);
    }
    const goalYd = 100 - ballOn;
    if (endzoneEl) {
      if (goalYd <= FIELD.maxY) { endzoneEl.style.display = 'block'; endzoneEl.style.height = toTop(goalYd) + '%'; }
      else endzoneEl.style.display = 'none';
    }
  }

  function updateReadBanner() {
    readText.innerHTML = coverage === 'man'
      ? 'Defense: <b>MAN</b> — read each matchup’s leverage'
      : coverage === 'zone'
        ? 'Defense: <b>COVER 3</b> — zone shell, deep thirds'
        : 'Defense: <b>BLITZ</b> — extra rusher; get it out quick';
    readBanner.dataset.coverage = coverage;
  }

  function updateHint() {
    hintBox.innerHTML = coverage === 'man'
      ? 'It’s <b>man</b>. Target a receiver whose route breaks <b>away</b> from his defender’s leverage — ' +
        'or a <b>drag</b>/<b>flat</b> that beats man underneath. Don’t throw a breaking route into the defender’s leverage.'
      : coverage === 'zone'
        ? 'It’s <b>Cover 3 zone</b>. Target a route that <b>sits in a soft spot</b> — a <b>hitch</b>, <b>curl</b>, or ' +
          '<b>flat</b>. Avoid the <b>out</b> (the curl-flat defender drives on it).'
        : 'It’s a <b>blitz</b>. An underneath defender is rushing — a quick throw is open, but a slow-developing route ' +
          '(<b>dig</b>, <b>curl</b>) gets you <b>sacked</b>. Hit a quick route (<b>slant</b>, <b>drag</b>, <b>flat</b>) now.';
  }

  // ---------- play / target pickers ----------
  function renderPlayPicker() {
    playPickerEl.innerHTML = '';
    PLAYS.forEach(function (pl) {
      const b = document.createElement('button');
      b.className = 'play-btn'; b.dataset.play = pl.id;
      b.innerHTML = '<span class="play-name">' + pl.name + '</span><span class="play-tag">' + pl.tag + '</span>';
      b.addEventListener('click', function () { selectPlay(pl); });
      playPickerEl.appendChild(b);
    });
    targetPickerEl.innerHTML = '';
    targetPickerEl.classList.add('hidden');
    targetLabel.classList.add('hidden');
  }

  function selectPlay(pl) {
    chosenPlay = pl; chosenTarget = null;
    document.querySelectorAll('.play-btn').forEach(function (b) { b.classList.toggle('selected', b.dataset.play === pl.id); });
    renderTargetPicker();
    resetFormation();
    drawPlayRoutes();
    snapBtn.disabled = true;
  }

  function renderTargetPicker() {
    targetPickerEl.innerHTML = '';
    ELIGIBLE.forEach(function (e) {
      const route = chosenPlay.routes[e.key];
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      const q = Sim.readStatus(route, coverage, lev);     // good | neutral | bad — colors the chip + route
      const look = coverage === 'zone' ? 'Zone' : (e.key === 'rb' ? 'LB' : cap(levMap[e.defKey]));
      const b = document.createElement('button');
      b.className = 'target-btn v-' + q; b.dataset.tkey = e.key;
      b.innerHTML = '<span class="t-pos">' + e.pos + '</span><span class="t-route">' + cap(route) +
                    '</span><span class="t-look">' + look + '</span>';
      b.addEventListener('click', function () { selectTarget(e.key); });
      targetPickerEl.appendChild(b);
    });
    targetPickerEl.classList.remove('hidden');
    targetLabel.classList.remove('hidden');
  }

  function selectTarget(key) {
    chosenTarget = key;
    document.querySelectorAll('.target-btn').forEach(function (b) { b.classList.toggle('selected', b.dataset.tkey === key); });
    ELIGIBLE.forEach(function (e) { chips[e.chip].classList.toggle('primary', e.key === key); });
    drawPlayRoutes();
    snapBtn.disabled = false;
  }

  // ---------- wiring ----------
  hintBtn.addEventListener('click', function () {
    const on = hintBox.classList.toggle('hidden') === false;
    hintBtn.setAttribute('aria-pressed', String(on));
  });
  snapBtn.addEventListener('click', function () {
    if (!chosenPlay || !chosenTarget) return;
    const e = elgByKey[chosenTarget];
    const result = Sim.resolvePlay({
      route: chosenPlay.routes[chosenTarget], coverage: coverage, leverage: levMap[e.defKey],
      receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb,
    });
    playReveal(result);
  });
  nextBtn.addEventListener('click', function () {
    if (!driveOver) { newPlay(); return; }
    showCpuPossession();
  });
  cpuContinueBtn.addEventListener('click', function () {
    if (drivesPlayed >= DRIVES_PER_GAME) showGameOver();
    else startDrive();
  });
  newGameBtn.addEventListener('click', newGame);

  // ---------- boot ----------
  buildChips();
  startDrive();
})();
