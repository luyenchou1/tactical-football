// game.js — DOM, rendering, interaction, and the tick-reveal animation.
// All matchup math lives in sim.js (window.Sim). This file only turns a
// resolved play into pixels and handles the pre-snap → snap → breakdown loop.

(function () {
  'use strict';

  // ---------- field coordinate system ----------
  // Yard space: x across the field [0..53.3], y downfield (LOS = 0, + = upfield
  // toward the defense). The visible window is mapped to the field box 0..100.
  const FIELD = { minY: -9, maxY: 21, width: 53.3 };
  function toLeft(x) { return (x / FIELD.width) * 100; }
  function toTop(y) { return ((FIELD.maxY - y) / (FIELD.maxY - FIELD.minY)) * 100; }

  // ---------- formation (base positions in yard space) ----------
  // role: off/def. key flag marks the 5 players in the matchup chain.
  const FORMATION = [
    // offensive line
    { id: 'C',  team: 'off', num: 55, x: 26.6, y: 0 },
    { id: 'LG', team: 'off', num: 66, x: 23.8, y: 0 },
    { id: 'RG', team: 'off', num: 67, x: 29.4, y: 0 },
    { id: 'LT', team: 'off', num: 73, x: 21.0, y: 0 },
    { id: 'RT', team: 'off', num: 76, x: 32.2, y: 0 },
    // backs / te / wrs
    { id: 'QB', team: 'off', num: 9,  x: 26.6, y: -5, simKey: 'qb' },
    { id: 'RB', team: 'off', num: 28, x: 23.2, y: -5 },
    { id: 'TE', team: 'off', num: 87, x: 18.4, y: 0 },
    { id: 'X',  team: 'off', num: 80, x: 5.0,  y: 0 },
    { id: 'Z',  team: 'off', num: 18, x: 48.0, y: 0 },
    { id: 'SLOT', team: 'off', num: 11, x: 38.0, y: 0, simKey: 'slot', primary: true },
    // defensive line
    { id: 'DE_L', team: 'def', num: 91, x: 21.0, y: 2 },
    { id: 'DT_L', team: 'def', num: 94, x: 24.6, y: 2 },
    { id: 'DT_R', team: 'def', num: 98, x: 28.6, y: 2 },
    { id: 'DE_R', team: 'def', num: 56, x: 32.2, y: 2 },
    // linebackers
    { id: 'MLB', team: 'def', num: 54, x: 27.0, y: 5.5, simKey: 'mlb' },
    { id: 'SLB', team: 'def', num: 50, x: 33.5, y: 6.0 },
    // secondary
    { id: 'CB_X', team: 'def', num: 24, x: 6.0,  y: 5.0 },
    { id: 'CB_Z', team: 'def', num: 21, x: 47.0, y: 5.0 },
    { id: 'NB',   team: 'def', num: 27, x: 40.0, y: 4.0, simKey: 'nb' },  // x set by leverage
    { id: 'SS',   team: 'def', num: 32, x: 18.4, y: 4.5 },
    { id: 'FS',   team: 'def', num: 31, x: 27.0, y: 14.0, simKey: 'fs' },
  ];

  // Display names for chips that have a sim player (so taps show real cards).
  const P = Sim.DEFAULT_PLAYERS;

  // ---------- slot route geometry (yard-space keyframes T0..T5) ----------
  // Right-side receiver: smaller x = inside (toward middle), larger x = sideline.
  const ROUTE_PATHS = {
    slant: [[38, 0], [38, 3], [34, 6], [31, 8], [31, 8], [27, 11]],
    out:   [[38, 0], [38, 4], [43, 6], [47, 6], [47, 6], [47, 9]],
    hitch: [[38, 0], [38, 6], [38, 4], [38, 4], [38, 4], [37, 6]],
  };
  // Faint default routes for the other receivers (pre-snap preview only).
  const DEFAULT_ROUTES = {
    X:  [[5, 0], [5, 12]],
    Z:  [[48, 0], [48, 6], [52, 7]],
    TE: [[18.4, 0], [13, 1]],
    RB: [[23.2, -5], [30, -3]],
  };

  // ---------- DOM refs ----------
  const fieldEl = document.getElementById('field');
  const routesSvg = document.getElementById('routes');
  const ballEl = document.getElementById('ball');
  const panel = {
    presnap: document.getElementById('presnap'),
    animating: document.getElementById('animating'),
    postplay: document.getElementById('postplay'),
  };
  const tickCaption = document.getElementById('tick-caption');
  const resultLine = document.getElementById('result-line');
  const breakdownEl = document.getElementById('breakdown');
  const snapBtn = document.getElementById('snap-btn');
  const nextBtn = document.getElementById('next-btn');
  const hintBtn = document.getElementById('hint-btn');
  const hintBox = document.getElementById('hint-box');
  const levWord = document.getElementById('lev-word');

  // ---------- game state ----------
  const chips = {};            // id -> element
  let leverage = 'outside';
  let chosenRoute = null;
  let down = 1, distance = 10, ballOn = -25, driveYards = 0;

  // ---------- chip rendering ----------
  function buildChips() {
    FORMATION.forEach(function (p) {
      const el = document.createElement('div');
      el.className = 'chip ' + p.team + (p.simKey ? ' key' : '') + (p.primary ? ' primary' : '');
      el.textContent = p.num;
      if (p.primary) {
        const s = document.createElement('span');
        s.className = 'star'; s.textContent = '★';
        el.appendChild(s);
      }
      el.addEventListener('click', function (e) { e.stopPropagation(); showCard(p); });
      fieldEl.appendChild(el);
      chips[p.id] = el;
    });
    // LOS + first-down lines
    addFieldLine('los', 0);
    addFieldLine('first', distanceToGo());
  }
  function distanceToGo() { return distance; } // yards beyond LOS for first down marker

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
    FORMATION.forEach(function (p) {
      let x = p.x;
      if (p.id === 'NB') x = leverage === 'outside' ? 40.0 : 36.0; // shade the slot
      placeChip(p.id, x, p.y);
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
    const s = pts.map(function (p) { return toLeft(p[0]) + ',' + toTop(p[1]); }).join(' ');
    el.setAttribute('points', s);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', faint ? '0.8' : '1.6');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    if (faint) {
      el.setAttribute('opacity', '0.5');
      el.setAttribute('marker-end', 'url(#arrow-faint)');
      el.style.color = 'rgba(255,255,255,0.35)';
    } else {
      el.setAttribute('marker-end', 'url(#arrow)');
      el.style.color = color;
    }
    routesSvg.appendChild(el);
  }
  function drawPreview() {
    clearRoutes();
    Object.keys(DEFAULT_ROUTES).forEach(function (id) {
      drawPolyline(DEFAULT_ROUTES[id], 'rgba(255,255,255,0.35)', true);
    });
    if (chosenRoute) {
      drawPolyline(ROUTE_PATHS[chosenRoute], '#ffcf33', false);
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
      const v = ratings[k];
      grid += '<div class="stat"><span class="k">' + k + '</span>' +
              '<span class="v ' + ratingClass(v) + '">' + v + '</span></div>';
    });
    cardEl.innerHTML =
      '<div class="card-top">' +
        '<div class="card-num" style="background:' + color + '">' + p.num + '</div>' +
        '<div><div class="card-name">' + name + '</div>' +
        '<div class="card-pos">' + posName(p) + '</div></div>' +
      '</div>' +
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
                  RB: 'Running Back', SS: 'Strong Safety' };
    return map[p.id] || (p.team === 'off' ? 'Offense' : 'Defense');
  }
  // deterministic-ish filler ratings for non-sim chips so taps always work
  function genericRatings(p) {
    const seed = p.num;
    const base = p.team === 'off' ? 72 : 74;
    function r(off) { return Math.max(55, Math.min(92, base + ((seed * (off + 3)) % 17) - 8)); }
    if (p.team === 'off') return { STR: r(1), RBK: r(2), PBK: r(3), AWR: r(4), AGI: r(5) };
    return { TKL: r(1), PRS: r(2), SPD: r(3), AWR: r(4), STR: r(5) };
  }

  // ---------- the tick reveal ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function buildScript(result) {
    // Returns per-tick positions for the animated actors + ball + captions.
    const route = result.meta.route;
    const slotPath = ROUTE_PATHS[route];
    const sep = result.meta.sep;
    const catchPt = slotPath[4];                 // where the ball arrives
    const caught = result.meta.caught;
    const intercepted = result.meta.intercepted;
    const undercut = result.meta.undercut;

    // NB trails the slot, beaten to the side the route breaks toward.
    const breakDir = route === 'slant' ? +1 : route === 'out' ? -1 : 0; // +1 = NB left behind toward sideline
    function nbAt(t) {
      const s = slotPath[t];
      if (t <= 1) return [leverage === 'outside' ? 40 : 36, 4 + t]; // pre-break shade
      return [s[0] + breakDir * (sep * 0.7), s[1] - (0.6 + sep * 0.55)];
    }
    // MLB: drifts up; if undercut, jumps the catch point at the throw.
    function mlbAt(t) {
      if (undercut && t >= 3) return [catchPt[0] + 1.2, catchPt[1] - 0.6];
      return [27 + t * 0.3, 5.5 + t * 0.6];
    }
    // FS: deep, comes downhill once the ball is out (pursuit).
    function fsAt(t) {
      if (t < 3) return [27, 14 - t * 0.3];
      return [catchPt[0] * 0.4 + 27 * 0.6, Math.max(catchPt[1] + 2, 14 - (t - 2) * 2.2)];
    }
    function ballAt(t) {
      if (t === 0) return [26.6, 0];
      if (t === 1 || t === 2) return [26.6, -4.5];
      if (t === 3) return catchPt;                 // throw travels
      if (t === 4) return catchPt;
      // t === 5
      if (intercepted) return nbAt(5);
      if (caught) return slotPath[5];
      return [catchPt[0], catchPt[1] - 1];         // incomplete: ball falls
    }

    const captions = [
      'Snap…',
      P.slot.name + ' releases',
      sep >= 2 ? 'Separation!' : sep === 1 ? 'A step open' : 'Blanketed',
      'Throw — ' + (result.chain.find(function (c) { return c.key === 'throw'; }) || { value: '' }).value,
      caught ? 'Caught!' : intercepted ? 'Picked off!' : 'Incomplete',
      result.outcome === 'completion' ? 'Tackled after the catch' : '',
    ];

    return { slotPath: slotPath, nbAt: nbAt, mlbAt: mlbAt, fsAt: fsAt, ballAt: ballAt,
             captions: captions, caught: caught, intercepted: intercepted };
  }

  async function playReveal(result) {
    const sc = buildScript(result);
    setStage('animating');
    clearRoutes();
    ballEl.style.opacity = '1';

    for (let t = 0; t < 6; t++) {
      placeChip('SLOT', sc.slotPath[t][0], sc.slotPath[t][1]);
      placeChip('NB', sc.nbAt(t)[0], sc.nbAt(t)[1]);
      placeChip('MLB', sc.mlbAt(t)[0], sc.mlbAt(t)[1]);
      placeChip('FS', sc.fsAt(t)[0], sc.fsAt(t)[1]);
      const b = sc.ballAt(t);
      placeBall(b[0], b[1]);
      if (t === 5 && !sc.caught && !sc.intercepted) ballEl.style.opacity = '0';
      if (sc.captions[t]) tickCaption.textContent = sc.captions[t];
      await sleep(t === 0 ? 450 : 700);
    }
    await sleep(450);
    showResult(result);
  }

  // ---------- result / breakdown ----------
  function showResult(result) {
    setStage('postplay');
    const o = result.outcome;
    let cls = 'neutral', txt = '';
    if (o === 'completion') { cls = 'good'; txt = 'Completion +' + result.yards; }
    else if (o === 'interception') { cls = 'bad'; txt = 'INTERCEPTED'; }
    else if (o === 'pbu') { cls = 'bad'; txt = 'Pass broken up'; }
    else { cls = 'neutral'; txt = 'Incomplete'; }
    resultLine.className = cls;
    resultLine.textContent = txt;

    breakdownEl.innerHTML = '';
    result.chain.forEach(function (step) {
      const row = document.createElement('div');
      row.className = 'bd-row';
      row.innerHTML =
        '<div class="bd-head">' +
          '<span class="bd-dot ' + (step.status || 'neutral') + '"></span>' +
          '<span class="bd-label">' + step.label + '</span>' +
          '<span class="bd-value">' + (step.value || '') + '</span>' +
        '</div>' +
        (step.detail ? '<div class="bd-detail">' + step.detail + '</div>' : '') +
        (step.math ? '<div class="bd-math">' + step.math + '</div>' : '');
      row.addEventListener('click', function () { row.classList.toggle('open'); });
      breakdownEl.appendChild(row);
    });

    advanceDown(result);
  }

  // ---------- drive state ----------
  function advanceDown(result) {
    const gain = Math.max(-10, result.yards | 0);
    if (result.outcome === 'interception') {
      // turnover — just reset the drive for the prototype
      down = 1; distance = 10; ballOn = -25; driveYards = 0;
    } else {
      ballOn += gain; driveYards += gain; distance -= gain;
      if (distance <= 0) { down = 1; distance = 10; }       // first down
      else { down += 1; if (down > 4) { down = 1; distance = 10; ballOn = -25; driveYards = 0; } }
    }
    updateHud();
  }
  function updateHud() {
    const ord = ['', '1st', '2nd', '3rd', '4th'][down] || '1st';
    document.getElementById('hud-down').textContent = ord + ' & ' + Math.max(1, distance);
    document.getElementById('hud-spot').textContent = (ballOn >= 0 ? '+' : '') + ballOn;
    document.getElementById('hud-drive').textContent = driveYards + ' yds';
  }

  // ---------- stage switching ----------
  function setStage(name) {
    Object.keys(panel).forEach(function (k) { panel[k].classList.toggle('hidden', k !== name); });
  }

  // ---------- new play ----------
  function newPlay() {
    leverage = Math.random() < 0.5 ? 'outside' : 'inside';
    chosenRoute = null;
    levWord.textContent = leverage;
    document.querySelectorAll('.route-btn').forEach(function (b) { b.classList.remove('selected'); });
    snapBtn.disabled = true;
    hintBox.classList.add('hidden');
    hintBtn.setAttribute('aria-pressed', 'false');
    updateHint();
    resetFormation();
    // reposition first-down line for current distance
    const fl = fieldEl.querySelector('.fieldline.first');
    if (fl) fl.style.top = toTop(distance) + '%';
    drawPreview();
    setStage('presnap');
  }

  function updateHint() {
    const best = leverage === 'outside' ? 'Slant' : 'Out';
    hintBox.innerHTML =
      'The nickel is shading <b>' + leverage + '</b>. Break <b>away</b> from his leverage: ' +
      'the <b>' + best + '</b> attacks the side he can’t defend. ' +
      'The hitch is the safe answer but gives up the easy yards after the catch.';
  }

  // ---------- wiring ----------
  document.querySelectorAll('.route-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      chosenRoute = btn.dataset.route;
      document.querySelectorAll('.route-btn').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      snapBtn.disabled = false;
      drawPreview();
    });
  });
  hintBtn.addEventListener('click', function () {
    const on = hintBox.classList.toggle('hidden') === false;
    hintBtn.setAttribute('aria-pressed', String(on));
  });
  snapBtn.addEventListener('click', function () {
    if (!chosenRoute) return;
    const result = Sim.resolvePlay(chosenRoute, leverage);
    playReveal(result);
  });
  nextBtn.addEventListener('click', newPlay);

  // ---------- boot ----------
  buildChips();
  updateHud();
  newPlay();
})();
