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
    reading: document.getElementById('reading'),
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
      el.className = 'chip ' + p.team + (p.simKey ? ' key' : '');
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
    const shade = {};
    if (revealed && coverage === 'man') {   // leverage is a post-snap tell — hidden while disguised
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
    }
  }

  // ---------- chip celebrations + on-fire streak ----------
  function chipFx(id, cls) { const el = chips[id]; if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function setOnFire(on) {
    onFire = on;
    ['X', 'Z', 'SLOT', 'TE', 'RB', 'QB'].forEach(function (id) { if (chips[id]) chips[id].classList.toggle('onfire', on); });
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
  function buildPreThrow() {
    const paths = {}, openAt = {}, status = {};
    ELIGIBLE.forEach(function (e) {
      const route = chosenPlay.routes[e.key];
      paths[e.chip] = routePath(baseX[e.chip], FORMATION.find(function (f) { return f.id === e.chip; }).y, route);
      const lev = coverage === 'zone' ? null : levMap[e.defKey];
      status[e.key] = Sim.readStatus(route, coverage, lev);                 // deterministic — matches the breakdown
      const tt = (Sim.ROUTES[route] || {}).tt || 1.8;
      openAt[e.key] = Math.round(Math.min(1400, Math.max(300, 200 + (tt - 1.2) * 520)));   // quick routes light early
    });
    function defDrop(e, t) {
      const rp = paths[e.chip][t];
      if (coverage === 'zone') {
        return [baseX[e.defChip], FORMATION.find(function (f) { return f.id === e.defChip; }).y + Math.min(t * 0.4, 1.6)];
      }
      const beat = 0.8, sideline = baseX[e.chip] < CENTER ? -1 : 1;          // neutral trail (sep unknown pre-throw)
      return [rp[0] + sideline * Math.min(beat, 2), rp[1] - (0.5 + beat * 0.3)];
    }
    return { paths: paths, defDrop: defDrop, openAt: openAt, status: status };
  }

  function placeReadTick(pre, t) {
    ELIGIBLE.forEach(function (e) {
      placeChip(e.chip, pre.paths[e.chip][t][0], pre.paths[e.chip][t][1]);
      if (e.key !== 'rb') { const d = pre.defDrop(e, t); placeChip(e.defChip, d[0], d[1]); }
    });
    placeChip('MLB', 27 + t * 0.2, 5.5 + t * 0.5);
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
          if (c) c.classList.remove('tappable', 'open-good', 'open-neutral', 'open-bad');
        });
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

      // live target row (mirrors the field; same settle())
      liveTargetsEl.innerHTML = '';
      ELIGIBLE.forEach(function (e) {
        const b = document.createElement('button');
        b.className = 'target-btn live'; b.dataset.tkey = e.key;
        b.innerHTML = '<span class="t-pos">' + e.pos + '</span><span class="t-route">' + cap(chosenPlay.routes[e.key]) + '</span>';
        b.addEventListener('click', function () { settle(e.key); });
        liveTargetsEl.appendChild(b);
        const c = chips[e.chip]; if (c) c.classList.add('tappable');
      });

      // routes develop (place at points 1→3)
      [1, 2, 3].forEach(function (p, i) {
        timers.push(setTimeout(function () { if (!settled) placeReadTick(pre, p); }, 240 + i * 270));
      });
      // openness lights as each route breaks
      ELIGIBLE.forEach(function (e) {
        timers.push(setTimeout(function () {
          if (settled) return;
          const c = chips[e.chip]; if (c) c.classList.add('open-' + pre.status[e.key]);
          const btn = liveTargetsEl.querySelector('[data-tkey="' + e.key + '"]');
          if (btn) btn.classList.add('v-' + pre.status[e.key]);
          if (pre.status[e.key] === 'good') sfx('open');
        }, pre.openAt[e.key]));
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
    if (driveResult === 'td') { sfx('td'); sfx('crowd'); announce('td'); addTrauma(0.75); flash('#f8b800', 0.55, 220); callout('td'); burstAt('td', 26.6, 12); popIn(document.getElementById('hud-score')); }
    else if (o === 'interception') { sfx('crowd'); announce('int'); callout('int'); streak = 0; setOnFire(false); }
    else if (o === 'sack') { announce('sack'); callout('sack'); streak = 0; setOnFire(false); }
    else if (o === 'completion' && result.meta.sep >= 2) {
      streak++;
      if (streak >= 3) { setOnFire(true); callout('fire'); announce('fire'); }
      else if (streak === 2) { callout('heating'); announce('fire'); }
      else { announce('dime'); callout('dime'); }
    }
    else if (o === 'completion') { if (firstDownThisPlay) callout('first'); }
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
    chosenPlay = null; chosenTarget = null;
    revealed = false;                 // hide the coverage until the snap
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
      readText.innerHTML = 'Defense: <b>? ? ?</b> — diagnose it after the snap';
      readBanner.dataset.coverage = 'hidden';
      return;
    }
    readText.innerHTML = coverage === 'man'
      ? 'Defense: <b>MAN</b> — read each matchup’s leverage'
      : coverage === 'zone'
        ? 'Defense: <b>COVER 3</b> — zone shell, deep thirds'
        : 'Defense: <b>BLITZ</b> — extra rusher; get it out quick';
    readBanner.dataset.coverage = coverage;
  }

  function updateHint() {
    if (!revealed) {
      hintBox.innerHTML = 'The defense is <b>disguised</b>. Call a play, then <b>snap</b> and read the rotation live — ' +
        'throw to whoever comes <b>open</b> (green) before the rush gets home.';
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
    if (fastMode) {                                   // ?fast: auto-pick the best read, skip the window
      revealCoverage();
      chosenTarget = bestRead();
      const e = elgByKey[chosenTarget];
      playReveal(Sim.resolvePlay({
        route: chosenPlay.routes[chosenTarget], coverage: coverage, leverage: levMap[e.defKey],
        receiver: P[e.key], defender: P[e.defKey], lb: P.mlb, qb: P.qb,
      }));
      return;
    }
    const choice = await runReadWindow();
    const targetKey = choice.targetKey;
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
