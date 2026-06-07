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
  const FIELD = { minY: -8, maxY: 18, width: 53.3 };   // tighter vertical window = more px/yard = less crowding
  function toLeft(x) { return (x / FIELD.width) * 100; }
  function toTop(y) { return ((FIELD.maxY - y) / (FIELD.maxY - FIELD.minY)) * 100; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- formation (base positions in yard space) ----------
  // Positions are stylized for legibility (top-down arcade view), not to scale:
  // wider O-line splits, the D-line set ~3yd off the ball, and the second level
  // pushed back so routes and animations read clearly with minimal chip overlap.
  const FORMATION = [
    { id: 'C',  team: 'off', num: 55, x: 26.6, y: 0 },
    { id: 'LG', team: 'off', num: 66, x: 23.3, y: 0 },
    { id: 'RG', team: 'off', num: 67, x: 29.9, y: 0 },
    { id: 'LT', team: 'off', num: 73, x: 20.0, y: 0 },
    { id: 'RT', team: 'off', num: 76, x: 33.2, y: 0 },
    { id: 'QB', team: 'off', num: 9,  x: 26.6, y: -5, simKey: 'qb' },
    { id: 'RB', team: 'off', num: 28, x: 21.5, y: -6, simKey: 'rb' },
    { id: 'TE', team: 'off', num: 87, x: 16.0, y: 0, simKey: 'te' },
    { id: 'X',  team: 'off', num: 80, x: 4.5,  y: 0, simKey: 'x' },
    { id: 'Z',  team: 'off', num: 18, x: 49.0, y: 0, simKey: 'z' },
    { id: 'SLOT', team: 'off', num: 11, x: 39.5, y: 0, simKey: 'slot' },
    { id: 'DE_L', team: 'def', num: 91, x: 20.0, y: 3.3 },
    { id: 'DT_L', team: 'def', num: 94, x: 24.2, y: 3.3 },
    { id: 'DT_R', team: 'def', num: 98, x: 29.0, y: 3.3 },
    { id: 'DE_R', team: 'def', num: 56, x: 33.2, y: 3.3 },
    { id: 'MLB', team: 'def', num: 54, x: 26.6, y: 7.0, simKey: 'mlb' },
    { id: 'SLB', team: 'def', num: 50, x: 33.5, y: 7.5 },
    { id: 'CB_X', team: 'def', num: 24, x: 5.0,  y: 6.5, simKey: 'cbX' },
    { id: 'CB_Z', team: 'def', num: 21, x: 48.0, y: 6.5, simKey: 'cbZ' },
    { id: 'NB',   team: 'def', num: 27, x: 40.0, y: 6.0, simKey: 'nb' },
    { id: 'SS',   team: 'def', num: 32, x: 16.0, y: 6.0, simKey: 'ss' },
    { id: 'FS',   team: 'def', num: 31, x: 26.6, y: 13.0, simKey: 'fs' },
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
  const LINEMEN = { C: 1, LG: 1, RG: 1, LT: 1, RT: 1, DE_L: 1, DT_L: 1, DT_R: 1, DE_R: 1 };   // the front — renders below the route layer so crossing routes stay visible

  // ---------- playbook ----------
  const PLAYS = [
    { id: 'slants',  name: 'Quick Slants', tag: 'man-beater · vs blitz',
      routes: { x: 'slant', z: 'slant', slot: 'slant', te: 'drag', rb: 'flat' } },
    { id: 'mesh',    name: 'Mesh', tag: 'man-beater',
      routes: { x: 'dig', z: 'drag', slot: 'drag', te: 'curl', rb: 'flat' } },
    { id: 'stick',   name: 'Stick', tag: 'zone-beater',
      routes: { x: 'out', z: 'curl', slot: 'hitch', te: 'dig', rb: 'flat' } },
    { id: 'spacing', name: 'Spacing', tag: 'zone-beater',
      routes: { x: 'hitch', z: 'out', slot: 'curl', te: 'drag', rb: 'flat' } },
    { id: 'verticals', name: 'Four Verticals', tag: 'zone-beater · deep',
      routes: { x: 'go', z: 'go', slot: 'post', te: 'corner', rb: 'flat' } },
    { id: 'smash',   name: 'Smash', tag: 'zone-beater · deep',
      routes: { x: 'hitch', z: 'corner', slot: 'hitch', te: 'drag', rb: 'flat' } },
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
      case 'go':    return [[x, y], [x, y + 4.5], [x, y + 9], [x, y + 13], [x, y + 13], [x, y + 16]];
      case 'post':  return [[x, y], [x, y + 5], [x, y + 9.5], [x + inX * 3, y + 12.5], [x + inX * 3, y + 12.5], [x + inX * 6.5, y + 15]];
      case 'corner':return [[x, y], [x, y + 5], [x, y + 9.5], [x + out * 2, y + 12.5], [x + out * 2, y + 12.5], [x + out * 4, y + 15]];
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
    reading: document.getElementById('reading'),
  };
  const tickCaption = document.getElementById('tick-caption');
  const resultLine = document.getElementById('result-line');
  const breakdownEl = document.getElementById('breakdown');
  const commentaryEl = document.getElementById('commentary');
  const rpPlayBtn = document.getElementById('rp-play');
  const rpCaptionEl = document.getElementById('rp-caption');
  const rpScrub = document.getElementById('rp-scrub');
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
  const yardNumsEl = document.getElementById('yardnums');
  const playPickerEl = document.getElementById('play-picker');
  const targetPickerEl = document.getElementById('target-picker');
  const targetLabel = document.getElementById('target-label');
  const liveTargetsEl = document.getElementById('live-targets');
  const pressureFill = document.getElementById('pressure-fill');

  // ---------- game state ----------
  const chips = {};
  let coverage = 'man';
  const levMap = {};                 // defKey -> 'inside' | 'outside' (man shade)
  let chosenPlay = null, chosenTarget = null;
  let revealed = false;              // disguise: true once the snap declares the coverage
  let shownLook = 'man';             // the pre-snap look the defense presents (can bluff the true call)
  let lastResult = null;             // the last resolved play, for the instant replay
  let down = 1, distance = 10, ballOn = 25;
  let score = 0;
  let drivePlays = 0, driveStartYard = 25;
  let driveOver = false, driveResult = null;   // 'td' | 'downs' | 'int'
  let firstDownThisPlay = false;
  let streak = 0, onFire = false;

  const DRIVES_PER_GAME = 5;
  let drivesPlayed = 0, tdCount = 0, gameOver = false;
  let cpuScore = 0;
  let bestScore = Number(localStorage.getItem('tf-best') || 0);
  const fastMode = /[?&]fast\b/.test(location.search);

  // ---------- chip rendering ----------
  function buildChips() {
    FORMATION.forEach(function (p) {
      const el = document.createElement('div');
      el.className = 'chip ' + p.team + (p.simKey ? ' key' : '') + (LINEMEN[p.id] ? ' lineman' : '');
      el.dataset.id = p.id;
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
    const look = revealed ? coverage : shownLook;        // the look the defense is presenting
    const press = (look === 'man' || look === 'blitz');  // press corners on man/blitz, a cushion on zone
    const cbY = press ? 1.8 : 6.5;
    const posOv = {                                      // depth tells for the secondary
      CB_X: [baseX['CB_X'], cbY], CB_Z: [baseX['CB_Z'], cbY],
      NB: [baseX['NB'], press ? 2.4 : 6.0], SS: [baseX['SS'], press ? 3.5 : 6.0],
    };
    if (look === 'blitz') posOv.SLB = [31, 1.7];         // a linebacker shows pressure in the gap
    const shade = {};
    if (look === 'man' || look === 'blitz') {            // leverage is a man/blitz read — shown pre-snap as a cue
      MAN_SHADE.forEach(function (e) {
        const rx = baseX[e.chip];
        const sideline = rx < CENTER ? -1 : 1;
        const dir = (levMap[e.defKey] === 'outside') ? sideline : -sideline;
        shade[e.defChip] = rx + dir * 3.2;
      });
    }
    FORMATION.forEach(function (p) {
      let x = posOv[p.id] ? posOv[p.id][0] : p.x;
      const y = posOv[p.id] ? posOv[p.id][1] : p.y;
      if (shade[p.id] !== undefined) x = shade[p.id];    // man leverage shade overrides x
      placeChip(p.id, x, y);
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
  function addLine(ptsStr, stroke, width, opacity) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    el.setAttribute('points', ptsStr);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', width);
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('opacity', opacity);
    el.setAttribute('marker-end', 'url(#arrow)');
    el.style.color = stroke;                          // currentColor feeds the arrowhead
    routesSvg.appendChild(el);
    return el;
  }
  // Each route is a dark casing + a bold bright line on top, so the path reads
  // at high contrast over both the grass and the player chips.
  function drawPolyline(pts, color, faint) {
    const ptsStr = pts.map(function (p) { return toLeft(p[0]) + ',' + toTop(p[1]); }).join(' ');
    const mainW = faint ? 3 : 5;
    const caseW = faint ? 5.5 : 8;
    const mainColor = faint ? '#ffffff' : color;
    addLine(ptsStr, 'rgba(0,0,0,0.62)', caseW, faint ? 0.7 : 0.88);   // dark casing underneath
    const main = addLine(ptsStr, mainColor, mainW, faint ? 0.9 : 1);   // bright line on top
    if (!faint) main.style.filter = 'drop-shadow(0 0 2.5px ' + color + ')';
    return main;
  }
  function drawPlayRoutes() {
    clearRoutes();
    if (!chosenPlay) return;
    let tgt = null;
    ELIGIBLE.forEach(function (e) {
      const pts = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, chosenPlay.routes[e.key]);
      if (e.key === chosenTarget) { tgt = { pts: pts, e: e }; return; }  // draw target last, on top
      drawPolyline(pts, null, true);                                     // non-target: bright white
    });
    if (tgt) {
      const lev = coverage === 'zone' ? null : levMap[tgt.e.defKey];
      const q = Sim.readStatus(chosenPlay.routes[tgt.e.key], coverage, lev);
      const color = q === 'good' ? '#22e34d' : q === 'bad' ? '#ff4133' : '#ffd21e';
      drawPolyline(tgt.pts, color, false);                              // target: thick, vivid, glowing
    }
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
  function sfx(n) { if (window.Sound) Sound.sfx(n); }
  function announce(k) { if (window.Sound) Sound.announce(k); }
  function crowd(k) { if (window.Sound) Sound.crowd(k); }
  function fanfare() { if (window.Sound) Sound.fanfare(); }
  function whoosh() { if (window.Sound) Sound.whoosh(); }
  function ding() { if (window.Sound) Sound.ding(); }

  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- trauma screen shake (shakes #field; chips ride along) ----------
  let trauma = 0, shakeRAF = 0, shakeT = 0;
  function addTrauma(amt) {
    if (reduceMotion || fastMode) return;
    trauma = Math.min(1, trauma + amt);
    fieldEl.style.willChange = 'transform';
    if (!shakeRAF) shakeRAF = requestAnimationFrame(shakeStep);
  }
  function shakeStep() {
    shakeT++;
    const s = trauma * trauma;                 // trauma² → smooth falloff
    const n = function (seed) { return 0.5 * Math.sin(shakeT * 0.55 + seed) + 0.5 * Math.sin(shakeT * 0.91 + seed * 2.3); };
    fieldEl.style.transform = 'translate(' + (8 * s * n(1)).toFixed(1) + 'px,' + (8 * s * n(9)).toFixed(1) + 'px) rotate(' + (1.2 * s * n(17)).toFixed(2) + 'deg)';
    trauma = Math.max(0, trauma - 0.028);      // ~1.6/sec decay at 60fps
    if (trauma > 0) shakeRAF = requestAnimationFrame(shakeStep);
    else { fieldEl.style.transform = ''; fieldEl.style.willChange = ''; shakeRAF = 0; }
  }

  // ---------- hit-pause + full-frame flash ----------
  async function hitPause(ms) { if (!fastMode) await sleep(ms); }   // hold the impact frame
  const flashEl = document.getElementById('flash');
  function flash(color, alpha, ms) {
    if (!flashEl) return;
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = String(reduceMotion ? Math.min(alpha, 0.25) : alpha);
    void flashEl.offsetWidth;
    flashEl.style.transition = 'opacity ' + ms + 'ms ease-out';
    flashEl.style.opacity = '0';
  }

  // ---------- NBA-Jam SLAM callouts ----------
  const calloutEl = document.querySelector('.callout');
  const CALLOUTS = {
    td:    ['TOUCHDOWN!', 'SIX POINTS!', 'TO THE HOUSE!'],
    int:   ['PICKED OFF!', 'INTERCEPTED!', 'HE READ IT!'],
    sack:  ['SACKED!', 'GOT HIM!', 'BURIED!'],
    dime:  ['DIME!', 'ON THE MONEY!', 'WHAT A READ!'],
    first: ['FIRST DOWN!', 'MOVE THE CHAINS!'],
    bigplay: ['BIG PLAY!', 'CHUNK GAIN!', 'EXPLOSIVE!'],
    heating: ['HEATING UP...'],
    fire: ['ON FIRE! 🔥', "HE'S ON FIRE!"],
  };
  const coIdx = {};
  function callout(kind) {
    if (!calloutEl || !CALLOUTS[kind]) return;
    const pool = CALLOUTS[kind];
    coIdx[kind] = (coIdx[kind] || 0) + 1;
    calloutEl.textContent = pool[coIdx[kind] % pool.length];
    calloutEl.className = 'callout ' + kind;
    void calloutEl.offsetWidth;            // retrigger the slam keyframe
    calloutEl.classList.add('slam');
  }

  // ---------- pooled particle FX (one canvas over the field, GC-free) ----------
  const fxCanvas = document.getElementById('fx');
  const fxCtx = fxCanvas ? fxCanvas.getContext('2d') : null;
  let fxW = 0, fxH = 0, fxRAF = 0;
  const POOL = [];
  for (let i = 0; i < 150; i++) POOL.push({ alive: false });

  function fxResize() {
    if (!fxCtx) return;
    const r = fieldEl.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);   // 3x retina triples fill for no gain
    fxW = r.width; fxH = r.height;
    fxCanvas.width = Math.round(fxW * dpr); fxCanvas.height = Math.round(fxH * dpr);
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fxResize);

  function fxSpawn(n, x, y, o) {
    if (reduceMotion || fastMode || !fxCtx) return;
    if (!fxW) fxResize();
    for (let i = 0, s = 0; i < POOL.length && s < n; i++) {
      const p = POOL[i]; if (p.alive) continue; s++;
      p.alive = true;
      if (o.rain) { p.x = Math.random() * fxW; p.y = -8; p.vx = (Math.random() - .5) * 1.5; p.vy = 1 + Math.random() * 2; }
      else {
        const ang = o.up ? (-Math.PI / 2 + (Math.random() - .5) * (o.spread || 1.4)) : Math.random() * 6.283;
        const sp = o.spdMin + Math.random() * (o.spdMax - o.spdMin);
        p.x = x; p.y = y; p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp - (o.up ? (o.lift || 0) : 0);
      }
      p.g = o.g; p.drag = o.drag; p.life = p.maxLife = o.life * (.7 + Math.random() * .6);
      p.size = o.size * (.6 + Math.random() * .8); p.rot = Math.random() * 6.283; p.vr = (Math.random() - .5) * .4;
      p.color = o.colors[(Math.random() * o.colors.length) | 0];
    }
    if (!fxRAF) fxRAF = requestAnimationFrame(fxStep);
  }

  function fxStep() {
    fxCtx.clearRect(0, 0, fxW, fxH);
    let any = false;
    for (let i = 0; i < POOL.length; i++) {
      const p = POOL[i]; if (!p.alive) continue; any = true;
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      if (p.life <= 0 || p.y > fxH + 20) { p.alive = false; continue; }
      fxCtx.globalAlpha = Math.max(0, p.life / p.maxLife);
      fxCtx.save(); fxCtx.translate(p.x, p.y); fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color; fxCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4); fxCtx.restore();
    }
    fxCtx.globalAlpha = 1;
    if (any) fxRAF = requestAnimationFrame(fxStep);
    else { fxCtx.clearRect(0, 0, fxW, fxH); fxRAF = 0; }   // idle-stop when none alive
  }

  function burstAt(kind, yx, yy) {
    if (!fxCtx) return;
    if (!fxW) fxResize();
    const x = toLeft(yx) / 100 * fxW, y = toTop(yy) / 100 * fxH;
    if (kind === 'td') {
      fxSpawn(70, x, y, { up: true, spread: 1.7, lift: 3, spdMin: 2, spdMax: 6, g: .18, drag: .96, life: 70, size: 6, colors: ['#f8b800', '#f8d878', '#0078f8', '#fcfcfc'] });
      fxSpawn(45, 0, 0, { rain: true, g: .12, drag: .99, life: 95, size: 6, colors: ['#f8b800', '#0078f8', '#f83800', '#fcfcfc'] });
    } else if (kind === 'sack') {
      fxSpawn(16, x, y, { up: false, spdMin: 1, spdMax: 3, g: .22, drag: .9, life: 34, size: 5, colors: ['#6b5030', '#8a6a40', '#3a2e1c'] });
    } else if (kind === 'int') {
      fxSpawn(22, x, y, { up: false, spdMin: 2, spdMax: 5, g: .2, drag: .92, life: 42, size: 5, colors: ['#e40058', '#ff5a3c', '#fcfcfc'] });
    } else if (kind === 'catch') {
      fxSpawn(15, x, y, { up: false, spdMin: 1.5, spdMax: 3.5, g: .2, drag: .92, life: 28, size: 4, colors: ['#46ff7a', '#00b800', '#fcfcfc'] });
    } else if (kind === 'big') {
      fxSpawn(38, x, y, { up: true, spread: 1.6, lift: 2.5, spdMin: 2, spdMax: 5, g: .18, drag: .95, life: 55, size: 5, colors: ['#f8b800', '#f8d878', '#fcfcfc'] });
    }
  }

  // ---------- chip celebrations + on-fire streak ----------
  function chipFx(id, cls) { const el = chips[id]; if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function setOnFire(on) {
    onFire = on;
    ['X', 'Z', 'SLOT', 'TE', 'RB', 'QB'].forEach(function (id) { if (chips[id]) chips[id].classList.toggle('onfire', on); });
  }

  // ---------- touchdown: a choreographed ~1.5s beat instead of one simultaneous pop ----------
  function slumpDefenders() {
    ['CB_X', 'CB_Z', 'NB', 'SS', 'MLB', 'SLB', 'FS', 'DE_L', 'DE_R', 'DT_L', 'DT_R'].forEach(function (id) { if (chips[id]) chipFx(id, 'slump'); });
  }
  function celebrateTD() {
    const scorer = (elgByKey[chosenTarget] || {}).chip;
    sfx('td'); addTrauma(0.85); flash('#fcfcfc', 0.6, 200); callout('td');   // boom + white pop + the SLAM
    if (scorer) chipFx(scorer, 'spike');                                      // the scorer leaps
    slumpDefenders();                                                         // the coverage sags
    setTimeout(fanfare, 110);                                                 // the jingle rings out
    setTimeout(function () { burstAt('td', 26.6, 12); }, 150);               // confetti
    setTimeout(function () { crowd('erupt'); }, 210);                        // the roar swells in
    setTimeout(function () { announce('td'); }, 330);                        // the call, over the crowd
    setTimeout(function () { popIn(document.getElementById('hud-score')); flash('#f8b800', 0.36, 280); }, 430);
    setTimeout(function () { burstAt('td', 26.6, 12); }, 720);               // a second pop
  }

  function buildScript(result, targetKey) {
    targetKey = targetKey || chosenTarget;
    const meta = result.meta;
    const sep = meta.sep, caught = meta.caught, intercepted = meta.intercepted, inLane = meta.undercut;
    const paths = {};
    ELIGIBLE.forEach(function (e) {
      paths[e.chip] = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, chosenPlay.routes[e.key]);
    });
    const tgt = elgByKey[targetKey] || ELIGIBLE[0];   // fallback for the synth-sack (target unused on a sack)
    const catchPt = paths[tgt.chip][3];
    // Who actually plays the ball: the MLB when it jumps the lane (or covers the RB underneath),
    // otherwise the target's own man defender. Drives the INT/PBU ball path + MLB converge.
    const mlbIsContester = inLane || (targetKey === 'rb' && sep === 0);
    const sacked = meta.sacked;
    function qbAt(t) { return t < 3 ? [26.6, -5] : [26.6, -5 - (t - 2) * 0.7]; }   // driven back when sacked

    function defAt(e, t) {
      const rp = paths[e.chip][t];
      if (coverage === 'zone') {                       // hold the zone, slight drop
        return [baseX[e.defChip], FORMATION.find(function (f) { return f.id === e.defChip; }).y + Math.min(t * 0.4, 1.6)];
      }
      const beat = (e.key === targetKey ? sep * 0.8 : 0.4);
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
    return { paths: paths, defAt: defAt, mlbAt: mlbAt, ballAt: ballAt, qbAt: qbAt, captions: captions, caught: caught, intercepted: intercepted, sacked: sacked, sep: sep, catchPt: catchPt, tgtChip: tgt.chip };
  }

  // Place every chip + the ball for one animation tick (shared by the read-window
  // front half and the throw/result back half).
  function placeTick(sc, t) {
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
  }

  // Front half: snap → routes develop → "open" read (ticks 0–2). Phase A runs this
  // non-interactively; Phase B swaps it for the interactive read window.
  async function playReveal(result) {
    const sc = buildScript(result, chosenTarget);
    setStage('animating');
    clearRoutes();
    ballEl.style.opacity = '1';
    for (let t = 0; t < 3; t++) {
      placeTick(sc, t);
      if (t === 0) { sfx('snap'); addTrauma(0.10); }
      else if (t === 2 && sc.sep >= 2 && !sc.sacked) sfx('open');
      await sleep(t === 0 ? 450 : 680);
    }
    await finishReveal(result, chosenTarget);
  }

  // Back half: throw → catch/PBU/INT/sack → cleanup (ticks 3–5), then the breakdown.
  // Called once the target is known (post-snap in Phase B) or for a synthesized sack.
  async function finishReveal(result, targetKey) {
    const sc = buildScript(result, targetKey);
    for (let t = 3; t < 6; t++) {
      placeTick(sc, t);
      if (t === 3 && !sc.sacked) { sfx('throw'); await hitPause(40); }
      else if (t === 4) {
        if (sc.sacked)           { sfx('sack');  addTrauma(0.55); flash('#e40058', 0.30, 200); burstAt('sack', 26.6, -2); chipFx('QB', 'squash'); }
        else if (sc.intercepted) { sfx('int');   addTrauma(0.65); flash('#e40058', 0.35, 200); burstAt('int', sc.catchPt[0], sc.catchPt[1]); }
        else if (sc.caught)      { sfx('catch'); addTrauma(0.30); flash('#fcfcfc', 0.50, 160); burstAt('catch', sc.catchPt[0], sc.catchPt[1]); chipFx(sc.tgtChip, 'celebrate'); }
        else if (result.outcome === 'pbu') { sfx('pbu'); addTrauma(0.35); }
        await hitPause(110);
      }
      await sleep(680);
    }
    await sleep(420);
    showResult(result);
  }

  // ---------- post-snap read window ----------
  const READ_WINDOW_MS = 2800;   // forgiving: time to scan and decide before the rush

  // Geometry + read cues for the live window — no result/roll needed yet.
  // Deterministic openness (0 blanketed … 1 wide open) for one receiver — shared by the
  // read window and the post-play commentary so the two can never drift.
  function opennessFor(key) {
    const e = elgByKey[key];
    const route = chosenPlay.routes[e.key];
    const lev = coverage === 'zone' ? null : levMap[e.defKey];
    const st = Sim.expectedSep({ route: route, coverage: coverage, leverage: lev, receiver: P[e.key], defender: P[e.defKey] });
    return Math.max(0, Math.min(1, (st - 44) / 40));
  }

  function buildPreThrow() {
    const paths = {}, status = {}, openness = {};
    ELIGIBLE.forEach(function (e) {
      const route = chosenPlay.routes[e.key];
      paths[e.chip] = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, route);
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      status[e.key] = Sim.readStatus(route, coverage, lev);                 // kept for tuning/cues; not shown as color
      openness[e.key] = opennessFor(e.key);                                 // shared deterministic openness
    });
    // The assigned defender trails the receiver along his route by a gap proportional to
    // the expected separation — so an open man visibly pulls away and a covered one is glued.
    function defDrop(e, t) {
      const pts = paths[e.chip];
      const i = Math.min(t, 3);
      const cur = pts[i], prev = pts[Math.max(0, i - 1)];
      let dx = cur[0] - prev[0], dy = cur[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;            // unit direction of travel
      const gap = 0.3 + openness[e.key] * 3.6;                               // yards of separation (open man pulls clearly away)
      const res = [cur[0] - dx * gap, cur[1] - dy * gap];
      if (e.key === 'rb') res[1] = Math.max(res[1], 5 * (1 - i / 3));        // MLB starts at LB depth, closes as the RB releases (not the backfield)
      return res;
    }
    return { paths: paths, defDrop: defDrop, status: status, openness: openness };
  }

  function placeReadTick(pre, t) {
    ELIGIBLE.forEach(function (e) {
      placeChip(e.chip, pre.paths[e.chip][t][0], pre.paths[e.chip][t][1]);
      const d = pre.defDrop(e, t); placeChip(e.defChip, d[0], d[1]);   // every receiver's man trails by his gap (incl. RB→MLB)
    });
  }

  // At the snap the disguised coverage declares itself: the banner flips to the true
  // call, the man defenders slide to their leverage, and the field flashes.
  function revealCoverage() {
    if (revealed) return;
    revealed = true;
    updateReadBanner();
    resetFormation();              // man leverage shade now applies → animated slide
    flash('#fcfcfc', 0.20, 150);
  }

  // The interactive front half: routes run live, openness reveals, you tap the open
  // man (chip or live-target row) before the rush. Resolves with the chosen target,
  // or null on expiry (→ synthesized sack). Race-safe via the single settle() guard.
  function runReadWindow() {
    return new Promise(function (resolve) {
      setStage('reading');
      clearRoutes();
      const pre = buildPreThrow();
      revealCoverage();                    // flip the banner + slide defenders to the true look
      ballEl.style.opacity = '1'; placeBall(26.6, -3);
      fieldEl.classList.add('reading');
      sfx('snap'); addTrauma(0.10);

      const timers = [];
      let settled = false;

      function settle(targetKey) {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        fieldEl.removeEventListener('click', onTap, true);
        fieldEl.classList.remove('reading');
        ELIGIBLE.forEach(function (e) {
          const c = chips[e.chip];
          if (c) { c.classList.remove('tappable'); delete c.dataset.postag; }
        });
        FORMATION.forEach(function (p) { if (chips[p.id]) chips[p.id].classList.remove('faded', 'rushing'); });
        if (pressureFill) { pressureFill.style.transition = 'none'; pressureFill.classList.remove('danger'); }
        if (targetKey) sfx('throw');
        resolve({ targetKey: targetKey });
      }
      function onTap(ev) {
        const chip = ev.target.closest ? ev.target.closest('.chip') : null;
        if (!chip) return;
        ev.stopImmediatePropagation();                  // suppress the stat card during the read
        const e = ELIGIBLE.find(function (x) { return x.chip === chip.dataset.id; });
        if (e) settle(e.key);
      }
      fieldEl.addEventListener('click', onTap, true);

      // live target row — jersey number ties each button to its chip on the field
      liveTargetsEl.innerHTML = '';
      ELIGIBLE.forEach(function (e) {
        const num = (FORMATION.find(function (f) { return f.id === e.chip; }) || {}).num;
        const b = document.createElement('button');
        b.className = 'target-btn live'; b.dataset.tkey = e.key;
        b.innerHTML = '<span class="t-num">' + num + '</span><span class="t-pos">' + e.pos + '</span><span class="t-route">' + cap(chosenPlay.routes[e.key]) + '</span>';
        b.addEventListener('click', function () { settle(e.key); });
        liveTargetsEl.appendChild(b);
        const c = chips[e.chip]; if (c) { c.classList.add('tappable'); c.dataset.postag = e.pos; }
      });

      // dim everyone but the 5 receiver↔defender matchups so separation reads clearly —
      // except the blitzer, who's making a play on the QB: keep him lit and flag the pressure
      const focus = {};
      ELIGIBLE.forEach(function (e) { focus[e.chip] = 1; focus[e.defChip] = 1; });
      if (coverage === 'blitz') focus.SLB = 1;
      FORMATION.forEach(function (p) { if (!focus[p.id] && chips[p.id]) chips[p.id].classList.add('faded'); });
      if (coverage === 'blitz' && chips.SLB) chips.SLB.classList.add('rushing');

      // routes develop (place at points 1→3); openness now reads off the defenders' separation
      [1, 2, 3].forEach(function (p, i) {
        timers.push(setTimeout(function () { if (!settled) placeReadTick(pre, p); }, 240 + i * 270));
      });
      // pressure bar drains over the window
      if (pressureFill) {
        pressureFill.style.transition = 'none'; pressureFill.style.width = '100%'; pressureFill.classList.remove('danger');
        timers.push(setTimeout(function () { pressureFill.style.transition = 'width ' + READ_WINDOW_MS + 'ms linear'; pressureFill.style.width = '0%'; }, 30));
        timers.push(setTimeout(function () { if (!settled) pressureFill.classList.add('danger'); }, Math.round(READ_WINDOW_MS * 0.62)));
      }
      // expiry → sack
      timers.push(setTimeout(function () { settle(null); }, READ_WINDOW_MS));
    });
  }

  // Best read for the ?fast path (mirrors drivesim's smart strategy): best status,
  // deeper route as the tie-break.
  function bestRead() {
    const rank = { good: 2, neutral: 1, bad: 0 };
    let best = ELIGIBLE[0].key, bestScore = -1;
    ELIGIBLE.forEach(function (e) {
      const route = chosenPlay.routes[e.key];
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      const score = rank[Sim.readStatus(route, coverage, lev)] * 100 + ((Sim.ROUTES[route] || {}).depth || 0);
      if (score > bestScore) { bestScore = score; best = e.key; }
    });
    return best;
  }

  // Window expired with no throw — synthesize a sack that flows through finishReveal /
  // showResult / advanceDown exactly like an engine sack (no resolvePlay call).
  function synthSack() {
    const yards = -(4 + Math.floor(Math.random() * 5));   // -4..-8
    return {
      outcome: 'sack', yards: yards,
      chain: [{ key: 'pressure', label: 'Pass rush', status: 'bad', value: 'SACK',
        detail: 'Held the ball too long — the rush got home before anyone came open.',
        math: 'no throw before the pocket collapsed' }],
      meta: { route: '(no throw)', coverage: coverage, leverage: null, receiver: '',
        sep: 0, window: 0, caught: false, intercepted: false, sacked: true, hurried: false, undercut: false },
    };
  }

  // ---------- result / breakdown ----------
  function numOf(chip) { const f = FORMATION.find(function (x) { return x.id === chip; }); return f ? f.num : '?'; }

  // ---------- post-play attribution (color commentary) ----------
  // Derive the causal context from the result + the player's decisions. Pure read of
  // module state; reuses the deterministic openness so it can't drift from the field.
  function analyzePlay(result) {
    const m = result.meta || {}, o = result.outcome;
    const open = {};
    ELIGIBLE.forEach(function (e) { open[e.key] = opennessFor(e.key); });
    let bestKey = ELIGIBLE[0].key;
    ELIGIBLE.forEach(function (e) {
      const better = open[e.key] > open[bestKey] + 1e-9;
      const tie = Math.abs(open[e.key] - open[bestKey]) <= 1e-9;
      const deeper = ((Sim.ROUTES[chosenPlay.routes[e.key]] || {}).depth || 0) > ((Sim.ROUTES[chosenPlay.routes[bestKey]] || {}).depth || 0);
      if (better || (tie && deeper)) bestKey = e.key;
    });
    const bE = elgByKey[bestKey];
    const best = { key: bestKey, num: numOf(bE.chip), pos: bE.pos, openness: open[bestKey] };

    let tgt = null, threwToBest = true, missMargin = 0;
    if (chosenTarget && elgByKey[chosenTarget]) {
      const e = elgByKey[chosenTarget], route = chosenPlay.routes[e.key];
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      const dr = (P[e.defKey] || {}).r || {};
      tgt = {
        key: e.key, num: numOf(e.chip), pos: e.pos, route: route, openness: open[e.key],
        readStatus: Sim.readStatus(route, coverage, lev),
        defNum: numOf(e.defChip), defName: (P[e.defKey] || {}).name || '',
        defCover: coverage === 'zone' ? (dr.ZON || 0) : (dr.COV || 0),
      };
      missMargin = best.openness - tgt.openness;
      threwToBest = (tgt.key === best.key) || (missMargin < 0.22) || (best.openness < 0.55);
    }

    const bluffed = shownLook !== coverage;
    const schemedFor = (chosenPlay.tag || '').indexOf('zone') >= 0 ? 'zone' : 'man';
    const schemeFit = coverage === 'zone' ? (schemedFor === 'zone') : (schemedFor === 'man');

    const byKey = {}; (result.chain || []).forEach(function (s) { byKey[s.key] = s; });
    const v = function (k) { return (byKey[k] && byKey[k].value) || ''; };
    let phase;
    if (o === 'sack' || m.sacked) phase = 'sack';
    else if (byKey.decision && /check/i.test(v('decision'))) phase = 'checkdown';
    else if (o === 'interception' || /intercept/i.test(v('contest'))) phase = 'picked';
    else if (o === 'pbu' || /broken/i.test(v('contest'))) phase = 'brokenup';
    else if (/drop/i.test(v('catch'))) phase = 'drop';
    else if (byKey.throw && byKey.throw.status === 'bad' && o !== 'completion') phase = 'badthrow';
    else if (/contested/i.test(v('catch'))) phase = 'contestedcatch';
    else if (o === 'completion') { phase = (parseInt(v('yac').replace(/[^0-9-]/g, ''), 10) || 0) >= 6 ? 'yac' : 'cleancomplete'; }
    else phase = 'incomplete';

    const expBucket = tgt ? (tgt.openness >= 0.66 ? 3 : tgt.openness >= 0.40 ? 2 : tgt.openness >= 0.18 ? 1 : 0) : 0;
    const realized = typeof m.sep === 'number' ? m.sep : 0;
    const sepDelta = realized - expBucket;
    let luck = 'neutral';
    if (tgt && o === 'completion') {            // covered on paper, came down with it → lucky
      if ((expBucket <= 1 && (phase === 'contestedcatch' || realized >= 2)) || sepDelta >= 2) luck = 'lucky';
    } else if (tgt) {                           // open on paper, fell apart → unlucky
      if ((expBucket >= 2 && (o === 'interception' || o === 'pbu' || phase === 'drop')) || sepDelta <= -2) luck = 'unlucky';
    }

    return { outcome: o, meta: m, coverage: coverage, shownLook: shownLook, bluffed: bluffed,
             schemedFor: schemedFor, schemeFit: schemeFit, hurried: !!m.hurried,
             tgt: tgt, best: best, threwToBest: threwToBest, missMargin: missMargin,
             phase: phase, luck: luck };
  }

  // Pick the dominant cause (+ optional secondary) — ordered so the headline teaches
  // the most actionable lesson (a missed open man beats a lucky completion).
  function attribute(ctx) {
    const t = ctx.tgt, b = ctx.best, o = ctx.outcome, failed = o !== 'completion';
    if (o === 'sack') {
      if (!t) return { cause: 'POST_SNAP', sub: null, key: 'never_threw' };
      if (ctx.coverage === 'blitz' && ctx.schemedFor !== 'man') return { cause: 'PRE_SNAP', sub: null, key: 'scheme_sack' };
      return { cause: 'EXECUTION', sub: ctx.bluffed ? 'PRE_SNAP' : null, key: 'pressure_sack' };
    }
    if (failed && ctx.bluffed && !ctx.schemeFit) return { cause: 'PRE_SNAP', sub: null, key: 'bluff_wrong' };
    if (t && !ctx.threwToBest) {
      if (o === 'completion') return { cause: 'POST_SNAP', sub: 'LUCK', key: 'missed_read_completed' };
      return { cause: 'POST_SNAP', sub: ctx.phase === 'picked' ? 'PERSONNEL' : null, key: 'missed_read' };
    }
    if (ctx.phase === 'checkdown') {
      const look = t ? t.openness : b.openness;
      if (look >= 0.50) return { cause: 'LUCK', sub: null, key: 'window_closed' };   // looked open, the roll went tight
      return { cause: (ctx.bluffed && !ctx.schemeFit) ? 'PRE_SNAP' : 'POST_SNAP', sub: null, key: 'checkdown_covered' };
    }
    if (t && failed && t.openness < 0.40 && t.defCover >= 80) {
      return { cause: 'PERSONNEL', sub: null, key: ctx.phase === 'picked' ? 'pick_on_talent' : 'lockdown_loss' };
    }
    if (ctx.luck === 'unlucky') return { cause: 'LUCK', sub: ctx.threwToBest ? 'POST_SNAP' : null, key: ctx.phase === 'drop' ? 'unlucky_drop' : 'unlucky_pbu_int' };
    if (ctx.luck === 'lucky') return { cause: 'LUCK', sub: null, key: 'lucky_contested' };
    if (o === 'completion') {
      if (t && t.openness >= 0.66) {
        const e = elgByKey[t.key], rec = (P[e.key] || {}).r || {}, def = (P[e.defKey] || {}).r || {};
        const mismatch = (rec.SPD - def.SPD >= 10) || (rec.RTE - (ctx.coverage === 'zone' ? def.ZON : def.COV) >= 12);
        if (mismatch) return { cause: 'PERSONNEL', sub: null, key: 'mismatch_win' };
      }
      return { cause: 'POST_SNAP', sub: ctx.phase === 'yac' ? 'yac' : null, key: ctx.phase === 'yac' ? 'right_read_yac' : 'right_read' };
    }
    if (ctx.phase === 'badthrow') return { cause: 'EXECUTION', sub: null, key: ctx.hurried ? 'bad_throw_hurried' : 'bad_throw' };
    if (ctx.phase === 'drop') return { cause: 'LUCK', sub: null, key: 'unlucky_drop' };
    return { cause: 'POST_SNAP', sub: null, key: 'checkdown_covered' };
  }

  // Color-commentary templates keyed by the attribution result; 2–3 variants each,
  // rotating per cell so repeats vary. Returns { text, cause }.
  const _coi = {};
  function buildCommentary(ctx) {
    const a = attribute(ctx), t = ctx.tgt, b = ctx.best;
    const T = t ? '#' + t.num : '', Tpos = t ? t.pos : '', Trte = t ? cap(t.route) : 'route';
    const D = t ? '#' + t.defNum : 'the defender';
    const B = '#' + b.num, Bpos = b.pos;
    const COV = { man: 'man', zone: 'the zone', blitz: 'the blitz' }[ctx.coverage] || ctx.coverage;
    const SCH = ctx.schemedFor === 'zone' ? 'zone' : 'man';
    const QB = (P.qb && P.qb.name) ? P.qb.name.split(' ').pop() : 'the QB';
    const LIB = {
      right_read: ['Perfect read — ' + T + ' won his matchup on the ' + Trte + ' and ' + QB + ' hit him in stride.',
                   'That’s how you attack ' + COV + ': ' + T + ' found the open window on the ' + Trte + '.',
                   T + ' came open against ' + COV + ' and ' + QB + ' didn’t miss him.'],
      right_read_yac: ['Great read to ' + T + ' on the ' + Trte + ', and he turned it up for a big gain after the catch.',
                       T + ' won on the ' + Trte + ' and made ' + D + ' miss for extra — that’s the dagger.'],
      missed_read: ['Right scheme, wrong read — ' + Bpos + ' ' + B + ' was wide open and the ball went to ' + T + ' in coverage.',
                    T + ' was blanketed; ' + Bpos + ' ' + B + ' had broken free and never got the look.',
                    'He stared down ' + Tpos + ' — ' + B + ' was the throw the whole way.'],
      missed_read_completed: ['It worked, but ' + B + ' was the better read — ' + T + ' was a tighter window than it needed to be.',
                              'Completed to ' + T + ', though ' + Bpos + ' ' + B + ' was running wide open for the easier throw.'],
      checkdown_covered: ['Coverage took everything away — ' + T + ' had no window and the QB checked it down.',
                          'Nothing came open against ' + COV + '; ' + QB + ' had to dump it off.'],
      window_closed: [T + ' looked open, but the window slammed shut before the ball got there.',
                      'The read was there, but ' + COV + ' rallied and closed it fast — no window.'],
      bluff_wrong: ['Beautiful disguise — they baited the ' + SCH + ' call and played ' + COV + ' instead.',
                    'They schemed for ' + SCH + ', but the defense showed a different look and rolled to ' + COV + '.',
                    'That’s on the look: a ' + SCH + ' concept run straight into ' + COV + '.'],
      scheme_sack: ['They dialed up a shot, but it was ' + COV + ' — the rush got home before it developed.',
                    'No chance on the protection: a slow-developing call against ' + COV + ', and ' + QB + ' goes down.'],
      pressure_sack: [QB + ' held it waiting for the ' + Trte + ' to develop and the rush buried him.',
                      'Coverage held just long enough — the route took too long and it’s a sack.'],
      never_threw: [QB + ' never pulled the trigger — nobody uncovered and the pocket caved.',
                    'Held it too long waiting for a window that never came.'],
      lockdown_loss: ['They made the right call, but ' + D + ' just blanketed ' + T + ' the whole way.',
                      'Can’t fault the read — ' + D + ' is a lockdown defender and smothered the ' + Trte + '.'],
      pick_on_talent: [D + ' read it the whole way and jumped the ' + Trte + ' for the takeaway — pure coverage.'],
      mismatch_win: ['Pure mismatch — ' + T + ' is too much for ' + D + ', open the moment the ' + Trte + ' broke.',
                     T + ' ran right by ' + D + '; that’s a talent edge the defense couldn’t cover.'],
      unlucky_drop: [T + ' was open — that one’s just a drop, nothing the defense did.',
                     'Right read, open man… ' + T + ' just couldn’t haul it in.'],
      unlucky_pbu_int: [T + ' had his man beat, but ' + D + ' recovered and made a play on the ball — tough break.',
                        'That should’ve been a completion; ' + D + ' made a heck of a play on it.'],
      lucky_contested: [T + ' was covered, but came down with it anyway — ' + QB + ' got away with one.',
                        'Tight window into ' + D + ', and ' + T + ' made it stick — a 50/50 that went their way.'],
      bad_throw: ['The window was there — ' + QB + ' just sailed it.',
                  QB + ' put it in a bad spot; ' + T + ' had no chance on it.'],
      bad_throw_hurried: ['Flushed off his spot, ' + QB + ' had to rush the throw to ' + T + ' and missed.',
                          'Under pressure, ' + QB + ' couldn’t set his feet and sailed it.'],
    };
    const arr = LIB[a.key] || LIB.right_read;
    _coi[a.key] = _coi[a.key] || 0;
    const text = arr[_coi[a.key] % arr.length];
    _coi[a.key] += 1;
    return { text: text, cause: a.cause };
  }

  // ---------- instant replay ----------
  // Rebuilds the just-run play from the deterministic builders and steps it frame-by-frame
  // on the field under manual controls. Frames 0–3 are the read (routes develop, the gaps
  // the player saw); 4–6 are the throw → result. No engine state, no new animation math.
  let rpPre = null, rpSc = null, rpFrames = [], rpFrame = 0, rpTimer = 0;

  function buildReplay() {
    rpFrames = [];
    if (!lastResult || !chosenPlay) return;
    rpPre = buildPreThrow();
    rpSc = buildScript(lastResult, chosenTarget);
    const o = lastResult.outcome;
    const readFrame = function (t) { return function () { placeReadTick(rpPre, t); ballEl.style.opacity = '1'; placeBall(26.6, -3); }; };
    const tickFrame = function (t) { return function () { placeTick(rpSc, t); }; };
    rpFrames = [
      { render: function () { resetFormation(); ballEl.style.opacity = '1'; placeBall(26.6, -3); }, cap: 'Snap', key: 'read' },   // the actual declared snap alignment (press/off + leverage), not the route-trail
      { render: readFrame(1), cap: 'Routes develop', key: 'separation' },
      { render: readFrame(2), cap: 'Routes develop', key: 'separation' },
      { render: readFrame(3), cap: 'The read — who’s open?', key: 'separation' },
      { render: tickFrame(3), cap: rpSc.captions[3] || 'Throw', key: rpSc.sacked ? 'pressure' : 'throw' },
      { render: tickFrame(4), cap: rpSc.captions[4] || '', key: rpSc.sacked ? 'pressure' : (rpSc.intercepted || o === 'pbu') ? 'contest' : 'catch' },
      { render: tickFrame(5), cap: rpSc.captions[5] || (o === 'completion' ? 'After the catch' : ''), key: rpSc.caught ? 'yac' : (rpSc.sacked ? 'pressure' : 'catch') },
    ];
    // dim the front so the receiver↔defender matchups read clearly through the middle on replay
    const rpFocus = {};
    ELIGIBLE.forEach(function (e) { rpFocus[e.chip] = 1; rpFocus[e.defChip] = 1; });
    if (coverage === 'blitz') rpFocus.SLB = 1;                              // keep the blitzer lit in the replay too
    FORMATION.forEach(function (p) { if (chips[p.id]) { chips[p.id].classList.toggle('faded', !rpFocus[p.id]); chips[p.id].classList.toggle('rushing', coverage === 'blitz' && p.id === 'SLB'); } });
  }

  function renderReplayFrame(i) {
    if (!rpFrames.length) return;
    rpFrame = Math.max(0, Math.min(rpFrames.length - 1, i));
    rpFrames[rpFrame].render();
    if (rpCaptionEl) rpCaptionEl.textContent = rpFrames[rpFrame].cap || '';
    if (rpScrub) rpScrub.value = String(rpFrame);
    const key = rpFrames[rpFrame].key;
    if (breakdownEl) breakdownEl.querySelectorAll('.bd-row').forEach(function (r) { r.classList.toggle('active', r.dataset.key === key); });
  }

  function rpPause() { if (rpTimer) { clearInterval(rpTimer); rpTimer = 0; } if (rpPlayBtn) rpPlayBtn.textContent = '▶'; }
  function rpPlay() {
    if (!rpFrames.length) return;
    if (rpTimer) { rpPause(); return; }                         // toggle
    if (rpFrame >= rpFrames.length - 1) renderReplayFrame(0);   // rewind from the end
    if (rpPlayBtn) rpPlayBtn.textContent = '⏸';
    rpTimer = setInterval(function () {
      if (rpFrame >= rpFrames.length - 1) { rpPause(); return; }
      renderReplayFrame(rpFrame + 1);
      if (rpFrame === 5) { const o = lastResult.outcome; sfx(o === 'completion' ? 'catch' : o === 'interception' ? 'int' : o === 'sack' ? 'sack' : 'pbu'); }
    }, 720);
  }
  function rpStep(d) { rpPause(); renderReplayFrame(rpFrame + d); }
  function rpScrubTo(v) { rpPause(); renderReplayFrame(parseInt(v, 10) || 0); }
  function rpTeardown() { rpPause(); if (breakdownEl) breakdownEl.querySelectorAll('.bd-row.active').forEach(function (r) { r.classList.remove('active'); }); FORMATION.forEach(function (p) { if (chips[p.id]) chips[p.id].classList.remove('faded', 'rushing'); }); }

  function showResult(result) {
    setStage('postplay');
    lastResult = result;
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
    try { const cm = buildCommentary(analyzePlay(result)); commentaryEl.textContent = cm.text; commentaryEl.dataset.cause = cm.cause; popIn(commentaryEl); } catch (e) { commentaryEl.textContent = ''; }
    buzz(driveResult === 'td' ? [40, 30, 70] : (o === 'interception' || o === 'sack') ? [70] : o === 'completion' ? 12 : 0);
    if (driveResult === 'td') { celebrateTD(); }
    else if (o === 'interception') { crowd('groan'); announce('int'); callout('int'); streak = 0; setOnFire(false); }
    else if (o === 'sack') { crowd('groan'); announce('sack'); callout('sack'); streak = 0; setOnFire(false); }
    else if (o === 'completion') {
      const gain = result.yards | 0;
      const clean = result.meta.sep >= 2;        // won the matchup
      const explosive = gain >= 20;              // a chunk play — the loudest non-TD beat
      if (clean) { streak++; } else { streak = 0; setOnFire(false); }
      const onFireNow = clean && streak >= 3;
      if (onFireNow) setOnFire(true);
      // one headline callout, by priority: explosive > on-fire > heating > first down > clean dime
      if (explosive) { callout('bigplay'); whoosh(); crowd('swell'); addTrauma(0.45); burstAt('big', 26.6, 10); }
      else if (onFireNow) { callout('fire'); }
      else if (clean && streak === 2) { callout('heating'); }
      else if (firstDownThisPlay) { callout('first'); ding(); }
      else if (clean) { callout('dime'); }
      // announcer VO, layered just behind the crowd
      setTimeout(function () {
        if (onFireNow) announce('fire');
        else if (explosive) announce('big');
        else if (clean && !firstDownThisPlay) announce('dime');
      }, explosive ? 180 : 0);
    }
    else { streak = 0; setOnFire(false); }   // incomplete / pbu breaks the streak

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
      row.className = 'bd-row'; row.dataset.key = step.key;
      row.innerHTML =
        '<div class="bd-head"><span class="bd-dot ' + (step.status || 'neutral') + '"></span>' +
        '<span class="bd-label">' + step.label + '</span>' +
        '<span class="bd-value">' + (step.value || '') + '</span></div>' +
        (step.detail ? '<div class="bd-detail">' + step.detail + '</div>' : '') +
        (step.math ? '<div class="bd-math">' + step.math + '</div>' : '');
      row.addEventListener('click', function () { row.classList.toggle('open'); });
      breakdownEl.appendChild(row);
    });
    buildReplay();
    if (rpFrames.length) renderReplayFrame(rpFrames.length - 1);
  }

  // ---------- drive + scoreboard ----------
  function advanceDown(result) {
    drivePlays += 1;
    firstDownThisPlay = false;
    if (result.outcome === 'interception') { driveOver = true; driveResult = 'int'; updateHud(); return; }
    const gain = result.yards | 0;                 // negative on a sack
    const nb = Math.max(1, ballOn + gain);         // clamp at our own goal line
    distance -= (nb - ballOn); ballOn = nb;        // distance moves by the ACTUAL change, not the clamped-away nominal
    if (ballOn >= 100) { ballOn = 100; score += 7; tdCount += 1; driveOver = true; driveResult = 'td'; }
    else if (gain > 0 && distance <= 0) { down = 1; distance = (100 - ballOn <= 10) ? (100 - ballOn) : 10; firstDownThisPlay = true; }
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
    document.getElementById('hud-score').textContent = score + '-' +cpuScore;
    document.getElementById('hud-drive').textContent = drivesPlayed + ' / ' + DRIVES_PER_GAME;
  }

  function setStage(name) {
    if (name !== 'postplay') rpTeardown();
    Object.keys(panel).forEach(function (k) { panel[k].classList.toggle('hidden', k !== name); });
    // menu music plays only while you're reading the defense; it ducks for the reveal
    if (window.Sound) { if (name === 'presnap') Sound.musicStart(); else Sound.musicStop(); }
  }

  // ---------- new drive / new play ----------
  function startDrive() {
    drivesPlayed += 1;
    ballOn = 25; down = 1; distance = 10; driveStartYard = 25;
    drivePlays = 0; driveOver = false; driveResult = null;
    streak = 0; setOnFire(false);
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
    if (pts > 0) popIn(document.getElementById('hud-score'));
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
    document.getElementById('go-score').textContent = score + '-' +cpuScore;
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
    sfx(result === 'WIN' ? 'win' : 'loss');
    if (result === 'WIN') { announce('win'); addTrauma(0.75); }
    setStage('gameover');
  }

  function newPlay() {
    const cr = Math.random();
    coverage = cr < 0.35 ? 'zone' : cr < 0.55 ? 'blitz' : 'man';   // man 0.45 / zone 0.35 / blitz 0.20
    ['cbX', 'cbZ', 'nb', 'ss', 'mlb'].forEach(function (k) { levMap[k] = Math.random() < 0.5 ? 'outside' : 'inside'; });
    // pre-snap tell: the shown look usually matches the true call, but ~1 in 4 it bluffs
    if (Math.random() < 0.25) {
      const others = ['man', 'zone', 'blitz'].filter(function (l) { return l !== coverage; });
      shownLook = others[Math.floor(Math.random() * others.length)];
    } else {
      shownLook = coverage;
    }
    chosenPlay = null; chosenTarget = null;
    revealed = false;                 // hide the coverage until the snap
    updateReadBanner();
    renderPlayPicker();
    snapBtn.disabled = true;
    snapBtn.textContent = 'SET ›';     // first press declares the defense; second press (HIKE) snaps
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
    // painted yard numbers — decorative field texture, accurate to the ball's position
    if (yardNumsEl) {
      yardNumsEl.innerHTML = '';
      for (let a = 10; a <= 90; a += 10) {
        const relY = a - ballOn;
        if (relY < FIELD.minY + 1.5 || relY > FIELD.maxY - 1.5) continue;
        const n = a <= 50 ? a : 100 - a;
        ['19', '81'].forEach(function (xp, idx) {
          const s = document.createElement('span');
          s.className = 'yardnum' + (idx ? ' flip' : '');
          s.textContent = n; s.style.left = xp + '%'; s.style.top = toTop(relY) + '%';
          yardNumsEl.appendChild(s);
        });
      }
    }
  }

  function updateReadBanner() {
    if (!revealed) {
      readText.innerHTML = 'Defense: <b>? ? ?</b> — read the leverage, then set';
      readBanner.dataset.coverage = 'hidden';
      return;
    }
    const name = coverage === 'man' ? 'MAN' : coverage === 'zone' ? 'COVER 3' : 'BLITZ';
    readText.innerHTML = 'Defense: <b>' + name + '</b> — audible or hike';   // declared at the snap
    readBanner.dataset.coverage = coverage;
  }

  function updateHint() {
    if (!revealed) {
      hintBox.innerHTML = '<b>Read the look:</b> <b>press</b> corners (tight on the receivers) hint man, ' +
        '<b>off</b> corners (a cushion) hint zone, and a <b>linebacker creeping</b> the line hints blitz. ' +
        'The defense can <b>disguise</b> — confirm after the snap, then throw to whoever wins his matchup before the rush gets home.';
      return;
    }
    hintBox.innerHTML = coverage === 'man'
      ? 'It’s <b>man</b>. Target a receiver whose route breaks <b>away</b> from his defender’s leverage — ' +
        'or a <b>drag</b>/<b>flat</b> that beats man underneath. Don’t throw a breaking route into the defender’s leverage.'
      : coverage === 'zone'
        ? 'It’s <b>Cover 3 zone</b>. Target a route that <b>sits in a soft spot</b> — a <b>hitch</b>, <b>curl</b>, or ' +
          '<b>flat</b>. Avoid the <b>out</b> (the curl-flat defender drives on it).'
        : 'It’s a <b>blitz</b>. A defender vacates underneath, so a <b>quick</b> throw (slant, drag, flat) is open and ' +
          'safe — or take a <b>deeper shot</b> (dig, curl) for more yards if you’ll risk the sack.';
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
    sfx('ui');
    chosenPlay = pl; chosenTarget = null;
    document.querySelectorAll('.play-btn').forEach(function (b) { b.classList.toggle('selected', b.dataset.play === pl.id); });
    resetFormation();
    drawPlayRoutes();
    snapBtn.disabled = false;   // the target is now chosen post-snap, in the read window
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
    sfx('ui');
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
  snapBtn.addEventListener('click', async function () {
    if (!chosenPlay) return;
    if (fastMode) {                                   // ?fast: declare + auto-pick + go in one press
      revealCoverage();
      chosenTarget = bestRead();
      const e = elgByKey[chosenTarget];
      playReveal(Sim.resolvePlay({
        route: chosenPlay.routes[chosenTarget], coverage: coverage, leverage: levMap[e.defKey],
        receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb,
      }));
      return;
    }
    if (!revealed) {                                  // SET — get to the line: the defense declares its true look
      revealCoverage();                               // rotates the shown look to the true coverage + flips the banner
      sfx('ui');
      snapBtn.textContent = 'HIKE ›';                 // now you may audible (tap a new play) or HIKE
      return;
    }
    // HIKE — snap it; the read window opens
    const choice = await runReadWindow();
    const targetKey = choice.targetKey;
    chosenTarget = targetKey;                         // reflect the post-snap pick in module state (for the breakdown + commentary)
    let result;
    if (targetKey) {
      const e = elgByKey[targetKey];
      result = Sim.resolvePlay({
        route: chosenPlay.routes[targetKey], coverage: coverage, leverage: levMap[e.defKey],
        receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb,
      });
    } else {
      result = synthSack();
    }
    await finishReveal(result, targetKey);
  });
  nextBtn.addEventListener('click', function () {
    sfx('ui');
    if (!driveOver) { newPlay(); return; }
    showCpuPossession();
  });
  cpuContinueBtn.addEventListener('click', function () {
    sfx('ui');
    if (drivesPlayed >= DRIVES_PER_GAME) showGameOver();
    else startDrive();
  });
  newGameBtn.addEventListener('click', function () { sfx('ui'); newGame(); });

  // instant replay controls
  if (rpPlayBtn) rpPlayBtn.addEventListener('click', function () { sfx('ui'); rpPlay(); });
  const rpBackBtn = document.getElementById('rp-back'); if (rpBackBtn) rpBackBtn.addEventListener('click', function () { rpStep(-1); });
  const rpFwdBtn = document.getElementById('rp-fwd'); if (rpFwdBtn) rpFwdBtn.addEventListener('click', function () { rpStep(1); });
  if (rpScrub) rpScrub.addEventListener('input', function () { rpScrubTo(rpScrub.value); });

  // ---------- sound mute toggle ----------
  const muteBtn = document.getElementById('mute-btn');
  function syncMute() {
    if (!muteBtn) return;
    const m = window.Sound ? Sound.isMuted() : false;
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', m);
  }
  if (muteBtn) muteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (window.Sound) { const nowMuted = Sound.setMuted(!Sound.isMuted()); if (!nowMuted) sfx('ui'); }
    syncMute();
  });
  syncMute();

  // ---------- boot ----------
  buildChips();
  fxResize();
  startDrive();
})();
