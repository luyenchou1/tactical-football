// sound.js — procedural arcade SFX + a speechSynthesis announcer for Tactical
// Football. Uses ZzFX (zzfx.js, loaded first). Zero audio assets. Mute is
// persisted to localStorage 'tf-sound'; audio unlocks on the player's first
// gesture. Everything is wrapped so it can never throw on the 60fps path.
(function (root) {
  'use strict';

  var muted = localStorage.getItem('tf-sound') === 'off';
  var unlocked = false;
  var mediaEl = null;

  // ---- multichannel SFX engine (from the SFX-juice research sprint) ----------
  // Each event layers a tonal body + a noise transient + (for impacts) a raw sub
  // thump, so it reads as a juicy arcade hit, not a flat blip. ZzFX params are
  // idx0..19; raw sub/noise layers route through the ZzFX AudioContext (zzfxX).
  // Everything no-ops when muted and is wrapped so it never throws.

  // ---- shared multichannel primitives -------------------------------------

  // layer(...arrays): fire N ZzFX param-arrays synchronously so they sum at
  // zzfxX.destination => instant polyphony. Each voice in its own try/catch.
  function layer() {
    if (muted) return;
    ensureUnlock();
    if (typeof zzfx === 'undefined') return;
    for (var i = 0; i < arguments.length; i++) {
      var p = arguments[i];
      if (!p) continue;
      try { zzfx.apply(null, p); } catch (e) {}
    }
  }

  // seq(steps): note sequencer for arps/jingles. steps = [[delayMs, paramArr],…].
  // Inner muted re-check so a jingle scheduled just before a mute falls silent.
  function seq(steps) {
    if (muted) return;
    ensureUnlock();
    steps.forEach(function (s) {
      setTimeout(function () {
        if (muted || typeof zzfx === 'undefined') return;
        try { zzfx.apply(null, s[1]); } catch (e) {}
      }, s[0]);
    });
  }

  // thump(f0,f1,dur,peak): raw-WebAudio sub-bass kick the ZzFX engine can't make.
  // Sine on zzfxX, freq exp-ramps f0->f1, gain ADSR to .001. The felt weight.
  function thump(f0, f1, dur, peak) {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime,
          o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(busIn());
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  // noiseHit(f,Q,type,dur,peak): raw-WebAudio filtered-noise transient. Gives a
  // real biquad-shaped click/whoosh the v1.3.2 engine has no filter param for.
  // type 'highpass' = crisp click, 'bandpass' = whoosh/snare-crack. sweep[ ] is
  // an optional [fStart,fEnd] to ramp the filter freq over dur (air whooshes).
  function noiseHit(f, Q, type, dur, peak, sweep) {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    try {
      var c = zzfxX, sr = c.sampleRate, n = Math.max(1, sr * dur | 0),
          b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = c.createBufferSource(); s.buffer = b;
      var bp = c.createBiquadFilter();
      bp.type = type; bp.Q.value = Q;
      var t = c.currentTime;
      if (sweep) {
        bp.frequency.setValueAtTime(sweep[0], t);
        bp.frequency.exponentialRampToValueAtTime(Math.max(1, sweep[1]), t + dur);
      } else {
        bp.frequency.value = f;
      }
      var g = c.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(bp); bp.connect(g); g.connect(busIn());
      s.start(t); s.stop(t + dur);
    } catch (e) {}
  }

  // bigHit(): lowpass-swept-noise "whump" + sine sub — the one impact ZzFX can't
  // synthesize. For marquee tackles / pick-six crashes only (call alongside sack).
  function bigHit() {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime, sr = c.sampleRate,
          dur = 0.22, n = sr * dur | 0,
          b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = c.createBufferSource(); s.buffer = b;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
      lp.frequency.setValueAtTime(2200, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(0.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(lp); lp.connect(g); g.connect(busIn());
      s.start(t); s.stop(t + dur);
    } catch (e) {}
    thump(80, 45, 0.18, 0.5);   // parallel sub
  }

  // jitter(layers, amt): lock ONE shared detune factor across all layers of a
  // tonally-related stack so the chord stays in tune (bigger than ZzFX idx1).
  function jitter(layers, amt) {
    var f = 1 + (Math.random() * 2 - 1) * (amt || 0.06);
    return layers.map(function (p) { var q = p.slice(); q[2] = q[2] * f; return q; });
  }

  // ---- master glue bus for the RAW-WebAudio layers (thump/noiseHit/bigHit/
  //      crowd) so stacked rapid plays compress/glue instead of clip. NOTE:
  //      ZzFX's own zzfx() hardwires to zzfxX.destination and can't be rerouted
  //      without editing zzfx.js, so this only catches the raw sub/noise energy
  //      (which is the stuff most prone to clipping). busIn() is lazy + safe.
  var _bus = null;
  function busIn() {
    if (typeof zzfxX === 'undefined') return null;
    if (_bus) return _bus;
    try {
      var comp = zzfxX.createDynamicsCompressor(), t = zzfxX.currentTime;
      comp.threshold.setValueAtTime(-18, t);
      comp.knee.setValueAtTime(6, t);
      comp.ratio.setValueAtTime(8, t);
      comp.attack.setValueAtTime(0.003, t);
      comp.release.setValueAtTime(0.15, t);
      comp.connect(zzfxX.destination);
      _bus = comp;
    } catch (e) { _bus = zzfxX.destination; }
    return _bus;
  }

  // ---- ZzFX param sets per event ------------------------------------------
  // Values are EITHER a flat 20-num array (single voice, played as-is) OR an
  // array-of-arrays (layered: every inner array is one summed voice). The
  // heavy multi-stage reward/impact events are tagged ['@fn', key] and dispatch
  // to a dedicated function (defined below) — so game.js's sfx('td') etc. keep
  // working with no call-site change.
  var SFX = {
    // UI tick: thin pointy-square body + featherweight high-noise click edge.
    // rand .08 so rapid taps detune slightly. No sub. ~45ms. NOT a reward.
    ui: [
      [.7,  .08, 1250, 0, .01, .02, 1, 2, , , , , , , , , , .6, .01],
      [.25, .12, 2600, 0, .004, .02, 4, 1, , , , , , 1.2, , , , .3, .01]
    ],

    // snap PAP: leather-pop noise tick + low triangle body w/ down-slide.
    // rand .10–.12 (anti-machine-gun) + a tiny raw sub via the dispatch fn.
    snap: ['@fn', 'snap'],

    // open: lowest reward rung — single thin/bright square with an UP pitchJump
    // (+220Hz ~perfect-4th leap) = "a window opened". rand low-ish (quasi-melodic).
    open: [.55, .05, 660, 0, .02, .05, 1, 1.8, , , 220, .04, , , , , , .6, .02],

    // throw: tonal zip body (saw, fast accel slide, small delay fattens it) +
    // a swept-bandpass noise air-tail (whip) added by the dispatch fn.
    throw: ['@fn', 'throw'],

    // catch GRAB: keep the upward pitchJump pop (fatter duty), rand .09, +a
    // tiny high-noise contact tick. 2-band, no sub, <120ms.
    catch: [
      [1.0, .09, 520, .008, .03, .06, 1, 1.8, , , 150, .04, , , , , , .8, .02],
      [.45, .15, 1200, 0, .004, .04, 4, 1, , , , , , 1, , , , .3, .03]
    ],

    // first / sack / int / td / win / loss => dedicated multi-stage functions.
    first: ['@fn', 'first'],
    sack:  ['@fn', 'sack'],
    int:   ['@fn', 'int'],
    td:    ['@fn', 'td'],
    win:   ['@fn', 'win'],
    loss:  ['@fn', 'loss'],

    // hurry: tense gritty saw that SINKS (neg slide) + repeatTime flutter =
    // anxious wobble. Lighter than sack (no sub). rand .10 so back-to-backs vary.
    hurry: [.7, .10, 160, .02, .05, .13, 2, .8, -6, , , , .07, 1, , .3, .1, .55, .04],

    // pbu CLAP: bright noise slap w/ FM modulation (metallic "ting" of contact)
    // + a low-mid saw knock w/ quick down-slide (the bat-away force). <130ms.
    pbu: [
      [1.1, .12, 650, 0, .01, .07, 4, 1, , , , , , 2, 12, .3, , .4, .03],
      [.7,  .10, 300, .005, .02, .06, 2, 1, -10, , , , , .4, , , , .4, .03]
    ],

    // whistle TWEET: keep the tremolo sine warble (pea rattle) + a faint
    // high-noise "air/breath" bed so it reads as blown metal, not a sine.
    whistle: [
      [.9,  .06, 2100, .015, .16, .04, 0, .5, , , , , , , , , , .7, , .6],
      [.22, .10, 3200, .01, .12, .04, 4, 1, , , , , , 1, , .4, , .45, .02]
    ],

    // crowd: handled by crowd(); kept as a fallback single-voice for sfx('crowd').
    crowd: [.7, .2, 500, .6, .9, .6, 4, .5, , , , , , 2, , , .3, .5, .4, .3]
  };

  // ---- dedicated multi-stage voices (rewards + impacts) -------------------
  // Each is SFX-only synth; game.js separately choreographs crowd()/announce().

  var FX = {
    // snap PAP: noise leather-pop + low body thump + tiny raw sub.
    snap: function () {
      layer(
        [.7,  .12, 1700, 0, .005, .03, 4, 1, , , , , , 2, , .15, , .3, .02],   // A pop
        [1.3, .10, 95,  .005, .02, .07, 1, 1.4, -4, , , , , 1, , , , .4, .04]  // B thud
      );
      thump(120, 70, 0.04, 0.30);                                             // C sub
    },

    // throw: tonal zip + airy swept whip.
    throw: function () {
      layer([.9, .06, 360, .01, .03, .09, 2, 1.6, -6, 40, , , , , , , .05, .6, .02]);
      noiseHit(1400, 1.2, 'bandpass', 0.10, 0.25, [1800, 700]);               // air whip
    },

    // first: Mario-coin 2-note ascending square 4th (G5->C6), top rings longer.
    first: function () {
      seq([
        [0,  [.5,  .03, 784,  .01, .03, .07, 2, 1.4, , , , , , , , , , .7,  .03]],
        [60, [.55, .03, 1047, .01, .06, .12, 2, 1.4, , , , , , , , , , .85, .04]]
      ]);
    },

    // sack: NFL-Blitz bone-crunch — noise crack + low saw down-whomp + sub thump.
    sack: function () {
      layer(
        [1.5, .15, 420, 0, .006, .06, 4, 1, , , , , , 2, , .4, , .4, .04],     // A crack
        [1.3, .10, 180, .01, .04, .16, 2, .7, -8, -25, , , , 1, , .15, , .4, .08] // B body
      );
      thump(150, 45, 0.07, 0.55);                                             // C felt sub
    },

    // int: two-stage momentum FLIP. Stage1 = pick + crash (down-snap + crack +
    // sub). Stage2 = short ascending runback arp.
    int: function () {
      layer(
        [1.4, .06, 440,  .02, .06, .20, 2, 1.1, , , -180, .10, , 1, , .1, , .7, .06], // down-snap
        [1.0, .12, 3000, 0, .006, .05, 4, 1, , , , , , 2, , .3, , .4, .04]            // crack
      );
      thump(180, 50, 0.16, 0.50);                                             // gut-drop
      seq([
        [140, [.5,  .04, 659, .01, .05, .10, 1, 1.4, , , 150, .05, , , , , , .75, .03]],
        [200, [.55, .04, 880, .01, .06, .13, 1, 1.4, , , 200, .06, , , , , , .85, .04]]
      ]);
    },

    // td: big SCORE slam — ascending major run (C-E-G-C, FM shimmer) w/ a long
    // ringing top, UNDER a sub boom + a bright sparkle on the final note.
    td: function () {
      seq([
        [0,   [.5, .03, 523,  .02, .07, .12, 1, 1.4, , , , , , , 12]],
        [70,  [.5, .03, 659,  .02, .07, .12, 1, 1.4, , , , , , , 12]],
        [140, [.5, .03, 784,  .02, .07, .12, 1, 1.4, , , , , , , 12]],
        [210, [.6, .03, 1047, .02, .22, .30, 1, 1.4, , , , , , , 20, , , .9, .10, .3]]
      ]);
      thump(110, 80, 0.45, 0.40);                                            // sub boom
      setTimeout(function () { noiseHit(6000, 0.7, 'highpass', 0.15, 0.20); }, 210); // sparkle
    },

    // win: grander, more resolved than td — 5-note triad+octave climb ending on
    // a sustained detuned-shimmer top (octave-doubled), over a long victory sub.
    win: function () {
      seq([
        [0,   [.5, .03, 523,  .02, .08, .12, 1, 1.4, , , , , , , 12]],   // C
        [70,  [.5, .03, 659,  .02, .08, .12, 1, 1.4, , , , , , , 12]],   // E
        [140, [.5, .03, 784,  .02, .08, .12, 1, 1.4, , , , , , , 12]],   // G
        [210, [.5, .03, 1047, .02, .08, .12, 1, 1.4, , , , , , , 16]],   // C (oct)
        [290, [.6, .04, 1319, .02, .30, .50, 1, 1.4, , , , , , , 24, , .2,  .95, .12, .35]], // ring
        [290, [.3, .04, 2637, .02, .28, .45, 1, 1.4, , , , , , , 24, , ,    .9,  .10, .35]]  // oct double
      ]);
      thump(98, 98, 0.70, 0.40);                                             // sustained sub
    },

    // loss: deflating descending minor "wah-wah" — soft saw, sags via neg slide,
    // longer sad tail. No noise/sub (must not feel powerful).
    loss: function () {
      seq([
        [0,   [1.0, .04, 392, .03, .10, .18, 2, 1, -4, , , , , , , , , .6,  .06]],
        [160, [1.1, .04, 311, .03, .16, .30, 2, 1, -6, , , , , , , , , .55, .10]]
      ]);
    }
  };

  // Build a tiny silent WAV data-URI at runtime (no memorized base64).
  function silentWavUri() {
    var sr = 8000, n = Math.floor(sr * 0.3), bytes = 44 + n;
    var buf = new Uint8Array(bytes), dv = new DataView(buf.buffer);
    function s(o, str) { for (var i = 0; i < str.length; i++) buf[o + i] = str.charCodeAt(i); }
    s(0, 'RIFF'); dv.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    s(36, 'data'); dv.setUint32(40, n, true);
    for (var i = 0; i < n; i++) buf[44 + i] = 128;   // 8-bit silence
    var bin = ''; for (var j = 0; j < bytes; j++) bin += String.fromCharCode(buf[j]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  function ensureUnlock() {
    if (unlocked) return;
    try {
      if (typeof zzfxX !== 'undefined' && zzfxX.state !== 'running') zzfxX.resume();
      // iOS routes WebAudio through the ringer channel; a looping silent <audio>
      // flips the page to the media channel so the mute switch doesn't kill it.
      if (!mediaEl) {
        mediaEl = new Audio(silentWavUri());
        mediaEl.loop = true; mediaEl.volume = 0.001;
        mediaEl.setAttribute('x-webkit-airplay', 'deny');
        mediaEl.play().catch(function () {});
      }
      unlocked = true;
    } catch (e) {}
  }

  // ---- sfx(name): backward-compatible dispatcher --------------------------
  //   numeric-first array  -> single zzfx (legacy + simple single-voice events)
  //   array-of-arrays      -> layer() each inner voice
  //   ['@fn', key]         -> call the dedicated FX[key]() multi-stage voice
  function sfx(name) {
    if (muted) return;
    ensureUnlock();
    var r = SFX[name];
    if (!r || typeof zzfx === 'undefined') return;
    try {
      if (r[0] === '@fn') { var fn = FX[r[1]]; if (fn) fn(); return; }
      if (typeof r[0] === 'number') { zzfx.apply(null, r); return; }
      layer.apply(null, r);                       // array-of-arrays
    } catch (e) {}
  }

  // ---- procedural crowd: filtered white-noise w/ a swept band + gain envelope.
  //      'erupt' (and big 'swell') additionally get a low sub-rumble bed and a
  //      few random broadband hand-claps so the roar reads full, not hissy.
  function crowd(kind) {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    var spec = {
      murmur: { dur: 0.9, peak: 0.10, rise: 0.55, f0: 600,  f1: 600,  q: 0.5 }, // idle
      swell:  { dur: 1.3, peak: 0.28, rise: 0.86, f0: 480,  f1: 1100, q: 0.8 }, // builds
      erupt:  { dur: 2.0, peak: 0.55, rise: 0.10, f0: 1000, f1: 1500, q: 1.2 }, // roar
      groan:  { dur: 1.1, peak: 0.20, rise: 0.16, f0: 440,  f1: 220,  q: 0.7 }  // sinks
    }[kind];
    if (!spec) return;
    try {
      var ctx = zzfxX, sr = ctx.sampleRate, n = Math.floor(sr * spec.dur);
      var buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = spec.q;
      var t0 = ctx.currentTime;
      bp.frequency.setValueAtTime(spec.f0, t0);
      bp.frequency.linearRampToValueAtTime(spec.f1, t0 + spec.dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(spec.peak, t0 + spec.dur * spec.rise);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + spec.dur);
      src.connect(bp); bp.connect(g); g.connect(busIn());
      src.start(t0); src.stop(t0 + spec.dur);

      // Fuller roar: only for the big peaks (erupt, loud swell).
      if (spec.peak > 0.4) {
        // (1) low sub-rumble bed: a 2nd noise buffer, lowpassed ~80Hz, slow swell.
        var rb = ctx.createBuffer(1, n, sr), rd = rb.getChannelData(0);
        for (var j = 0; j < n; j++) rd[j] = Math.random() * 2 - 1;
        var rs = ctx.createBufferSource(); rs.buffer = rb;
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 80; lp.Q.value = 0.7;
        var rg = ctx.createGain();
        rg.gain.setValueAtTime(0.001, t0);
        rg.gain.exponentialRampToValueAtTime(0.30, t0 + spec.dur * 0.4);
        rg.gain.exponentialRampToValueAtTime(0.001, t0 + spec.dur);
        rs.connect(lp); lp.connect(rg); rg.connect(busIn());
        rs.start(t0); rs.stop(t0 + spec.dur);

        // (2) 4 random broadband hand-claps scattered across the first ~60%.
        for (var c = 0; c < 4; c++) {
          var cn = Math.max(1, sr * 0.03 | 0),
              cb = ctx.createBuffer(1, cn, sr), cd = cb.getChannelData(0);
          for (var k = 0; k < cn; k++) cd[k] = Math.random() * 2 - 1;
          var cs = ctx.createBufferSource(); cs.buffer = cb;
          var cg = ctx.createGain();
          var ct = t0 + Math.random() * spec.dur * 0.6;
          cg.gain.setValueAtTime(0.15, ct);
          cg.gain.exponentialRampToValueAtTime(0.001, ct + 0.03);
          cs.connect(cg); cg.connect(busIn());
          cs.start(ct); cs.stop(ct + 0.03);
        }
      }
    } catch (e) {}
  }

  // ---- richer one-shots: brighter Tecmo fanfare, an airy riser, a coin ding -

  // kept for any legacy callers; thin single triangle pluck.
  function note(freq, vol, atk, sus, rel, shape) {
    if (muted || typeof zzfx === 'undefined') return;
    try { zzfx(vol, .05, freq, atk, sus, rel, shape, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .02); } catch (e) {}
  }

  // fanfare: tighter/brighter square climb (~60ms steps) + a detuned shimmer
  // ring on the held top w/ a quiet octave-up double. (Essentially the td run.)
  function fanfare() {
    seq([
      [0,   [.45, .03, 523,  .01, .06, .10, 2, 1.4]],
      [60,  [.45, .03, 659,  .01, .06, .10, 2, 1.4]],
      [120, [.45, .03, 784,  .01, .06, .10, 2, 1.4]],
      [180, [.5,  .03, 1047, .01, .20, .36, 2, 1.4, , , , , , , 18, , .12, .9, .10, .3]],
      [180, [.25, .03, 2094, .01, .18, .30, 2, 1.4, , , , , , , 18]]   // octave shimmer
    ]);
  }

  // whoosh: bigger airy riser — rising saw lead + triangle octave-down body for
  // soft lift + a rising bandpass-noise air bed. Upward = positive/lift.
  function whoosh() {
    layer(
      [.5, .05, 170, .02, .26, .3, 1, 1.2, 13, 7, , , .1, , , , , .5, .1],   // A lead
      [.4, .05, 85,  .02, .26, .3, 1, 1.4, 6,  4, , , , , , , , .5, .1]      // B body
    );
    noiseHit(900, 1.0, 'bandpass', 0.30, 0.18, [400, 1800]);                 // rising air
  }

  // ding: brighter coin-style 2-note up-bling — square (not triangle), top
  // note rings a touch longer. Reusable micro-reward building block.
  function ding() {
    seq([
      [0,  [.4,  .04, 880,  .01, .04, .08, 2, 1.6, , , , , , , , , , .8, .02]],
      [70, [.45, .04, 1320, .01, .06, .13, 2, 1.6, , , , , , , , , , .9, .04]]
    ]);
  }

  // ---- speechSynthesis announcer (the big beats only — NBA-Jam restraint) ----
  var PHRASES = {
    td:   ['Touchdown!', 'He could go all the way!', 'Boom! Six points!'],
    int:  ['Intercepted!', 'Picked off — he read it!', 'Oh, pick six!'],
    sack: ['Sacked!', 'Down goes the quarterback!', 'Got him!'],
    dime: ['Dime!', 'On the money!', 'What a read!'],
    big:  ['Big gainer!', 'He has got room!', 'Chunk play — moving!'],
    fire: ['He is heating up!', 'He is on fire!'],
    win:  ['Game! You win!', 'Ball game!']
  };
  var voice = null, vi = 0, hasSpeech = (typeof speechSynthesis !== 'undefined');
  function pickVoice() {
    try {
      var vs = speechSynthesis.getVoices();
      voice = vs.filter(function (v) { return /Daniel|Google US English|Samantha|Alex|Aaron/.test(v.name); })[0] || vs[0] || null;
    } catch (e) {}
  }
  if (hasSpeech) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {} }

  // Recorded VO clips can drop in here later (kind -> [Audio]); empty today = procedural TTS.
  var CLIPS = {};
  function playClip(kind) { try { var a = CLIPS[kind][(vi++) % CLIPS[kind].length]; a.currentTime = 0; a.volume = 1; a.play(); } catch (e) {} }

  function announce(kind) {
    if (muted) return;
    if (CLIPS[kind] && CLIPS[kind].length) { playClip(kind); return; }   // a recorded VO clip wins when present
    if (!hasSpeech) return;
    var pool = PHRASES[kind]; if (!pool) return;
    var line = pool[(vi++) % pool.length];
    try {
      speechSynthesis.cancel();                       // never queue/stack on fast sequences
      var u = new SpeechSynthesisUtterance(line);
      if (voice) u.voice = voice;
      u.rate = 1.1; u.pitch = 1.3; u.volume = 1;
      speechSynthesis.resume();                        // Chrome ~15s pause bug
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('tf-sound', muted ? 'off' : 'on'); } catch (e) {}
    if (muted && hasSpeech) { try { speechSynthesis.cancel(); } catch (e) {} }
    if (muted) musicStop();
    return muted;
  }
  function isMuted() { return muted; }

  // global one-shot unlock on the first real gesture (capture + passive)
  function gestureUnlock() { ensureUnlock(); }
  ['touchend', 'mousedown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, gestureUnlock, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && unlocked) { try { if (zzfxX.state !== 'running') zzfxX.resume(); } catch (e) {} }
  });

  // ---------- minimal menu music (procedural — a gentle loop that ducks during the reveal) ----------
  var MUSIC = [220, 262, 330, 262, 196, 247, 294, 247];   // soft Am↔G arpeggio
  var mStep = 0, mTimer = 0;
  var NOTE = [0.05, .02, 0, .01, .08, .12, 1, .8];        // low-volume triangle pluck
  function musicNote() {
    if (muted || typeof zzfx === 'undefined') return;
    try { var p = NOTE.slice(); p[2] = MUSIC[mStep % MUSIC.length]; p[17] = .35; p[18] = .03; zzfx.apply(null, p); } catch (e) {}
    mStep++;
  }
  function musicStart() { if (mTimer || muted) return; ensureUnlock(); musicNote(); mTimer = setInterval(musicNote, 300); }
  function musicStop() { if (mTimer) { clearInterval(mTimer); mTimer = 0; } }

  root.Sound = { sfx: sfx, crowd: crowd, fanfare: fanfare, whoosh: whoosh, ding: ding, announce: announce, setMuted: setMuted, isMuted: isMuted, ensureUnlock: ensureUnlock, musicStart: musicStart, musicStop: musicStop };
})(window);
