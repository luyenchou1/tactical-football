// sound.js — procedural arcade SFX + a speechSynthesis announcer for Tactical
// Football. Uses ZzFX (zzfx.js). Recorded clips in sfx/ are preferred when loaded,
// with the procedural synth as the always-available fallback. Mute is
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

  // ---- recorded-sample playback: prefer a real clip, fall back to procedural ----
  //   MP3s in web/sfx/ are decoded to AudioBuffers on the first gesture, played
  //   through the same compressor bus as the synth, round-robined per key, and
  //   muted-safe. If a clip isn't loaded yet (or is missing) playSample() returns
  //   false and the caller's procedural version plays — so nothing ever goes silent.
  var SAMPLE_URLS = {
    ambient: ['sfx/crowd3.mp3'],                     // one long crowd-murmur loop (no recognizable chants)
    snap:    ['sfx/snap.mp3'],
    whistle: ['sfx/whistle.mp3'],
    cheer:   ['sfx/cheer.mp3'],
    ohh:     ['sfx/ohh.mp3'],
    hit:     ['sfx/hit1.mp3', 'sfx/hit2.mp3'],
    catch:   ['sfx/catch1.mp3', 'sfx/catch2.mp3']
  };
  var SAMPLES = {}, _rr = {}, _samplesLoaded = false;
  function loadSamples() {
    if (_samplesLoaded || typeof zzfxX === 'undefined' || typeof fetch === 'undefined') return;
    _samplesLoaded = true;
    Object.keys(SAMPLE_URLS).forEach(function (key) {
      SAMPLES[key] = [];
      SAMPLE_URLS[key].forEach(function (url, i) {
        fetch(url).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (ab) { return ab ? zzfxX.decodeAudioData(ab) : null; })
          .then(function (buf) { if (buf) SAMPLES[key][i] = buf; })
          .catch(function () {});
      });
    });
  }
  function playSample(key, vol, dur) {
    if (muted || typeof zzfxX === 'undefined') return false;
    var arr = SAMPLES[key]; if (!arr) return false;
    var avail = arr.filter(Boolean); if (!avail.length) return false;   // not decoded yet -> procedural fallback
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime;
      _rr[key] = ((_rr[key] || 0) + 1) % avail.length;                  // round-robin the variants
      var src = c.createBufferSource(); src.buffer = avail[_rr[key]];
      var g = c.createGain(); g.gain.value = vol == null ? 1 : vol;
      src.connect(g); g.connect(busIn());
      src.start(t);
      if (dur) {                                                        // cap + fade long crowd clips
        g.gain.setValueAtTime(g.gain.value, t + Math.max(0, dur - 0.3));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        src.stop(t + dur + 0.02);
      }
      return true;
    } catch (e) { return false; }
  }

  // ---- 16-bit synth voice: FM + detuned unison + filter-env + reverb send ----
  //   The Sega/SNES/arcade move ZzFX (an 8-bit micro-synth) can't make: an FM
  //   carrier for a brassy/metallic body, detuned unison for width, a lowpass
  //   filter envelope for movement, optional waveshaper grit, and a convolver
  //   reverb send for space. All on the ZzFX AudioContext (zzfxX); never throws;
  //   muted-safe. This is what moves the kit from 1980s 8-bit to 1990s 16-bit.

  var _verbIn = null;
  function reverbIn() {                       // shared procedural-IR convolver send
    if (_verbIn) return _verbIn;
    try {
      var c = zzfxX, sr = c.sampleRate, len = (sr * 0.8) | 0;
      var ir = c.createBuffer(2, len, sr);
      for (var ch = 0; ch < 2; ch++) {
        var dd = ir.getChannelData(ch);
        for (var i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      var conv = c.createConvolver(); conv.buffer = ir;
      var wet = c.createGain(); wet.gain.value = 0.85;
      _verbIn = c.createGain();
      _verbIn.connect(conv); conv.connect(wet); wet.connect(busIn());
    } catch (e) { _verbIn = busIn(); }
    return _verbIn;
  }

  var _dcache = {};
  function distCurve(amt) {                    // soft-clip waveshaper (arcade grit)
    if (_dcache[amt]) return _dcache[amt];
    var n = 1024, curve = new Float32Array(n), k = amt * 60;
    for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return _dcache[amt] = curve;
  }

  // synth(o): one FM/subtractive note. o = { f, dur, vol, type, a,d,s,r (ADSR),
  //   uni:[cents…] (unison voices), slideTo,slideDur (pitch sweep),
  //   fm:{ratio,index,decay,type}, filt:{f0,f1,q}, dist:0..1, send:0..1 }
  function synth(o) {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime, f = o.f, dur = o.dur || 0.25,
          vol = o.vol == null ? 0.3 : o.vol,
          a = o.a || 0.005, d = o.d || 0.05, s = o.s == null ? 0.6 : o.s, r = o.r || 0.12,
          end = t + a + d + dur, stop = end + r + 0.05;
      var amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(vol, t + a);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * s), t + a + d);
      amp.gain.setValueAtTime(Math.max(0.0001, vol * s), end);
      amp.gain.exponentialRampToValueAtTime(0.0001, end + r);

      var node = amp;
      if (o.filt) {
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = o.filt.q || 2;
        lp.frequency.setValueAtTime(o.filt.f0, t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.filt.f1), t + a + d + dur * 0.6);
        amp.connect(lp); node = lp;
      }
      if (o.dist) { var ws = c.createWaveShaper(); ws.curve = distCurve(o.dist); ws.oversample = '2x'; node.connect(ws); node = ws; }
      node.connect(busIn());
      if (o.send) { var sg = c.createGain(); sg.gain.value = o.send; node.connect(sg); sg.connect(reverbIn()); }

      var uni = o.uni || [0], carriers = [];
      uni.forEach(function (cents) {
        var osc = c.createOscillator(); osc.type = o.type || 'sawtooth';
        osc.frequency.setValueAtTime(f, t);
        if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + (o.slideDur || dur));
        osc.detune.value = cents;
        osc.connect(amp); osc.start(t); osc.stop(stop); carriers.push(osc);
      });
      if (o.fm) {
        var mod = c.createOscillator(); mod.type = o.fm.type || 'sine';
        mod.frequency.setValueAtTime(f * (o.fm.ratio || 1), t);
        if (o.slideTo) mod.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo * (o.fm.ratio || 1)), t + (o.slideDur || dur));
        var mg = c.createGain(), idx0 = f * (o.fm.index || 2);
        mg.gain.setValueAtTime(idx0, t);
        mg.gain.exponentialRampToValueAtTime(Math.max(1, idx0 * (o.fm.decay == null ? 0.25 : o.fm.decay)), t + a + d + dur * 0.7);
        mod.connect(mg); carriers.forEach(function (osc) { mg.connect(osc.frequency); });
        mod.start(t); mod.stop(stop);
      }
    } catch (e) {}
  }
  function chord(freqs, o) { freqs.forEach(function (f) { var q = {}; for (var k in o) q[k] = o[k]; q.f = f; synth(q); }); }
  function arp(steps, o) { steps.forEach(function (st, i) { setTimeout(function () { var q = {}; for (var k in o) q[k] = o[k]; q.f = st[1]; synth(q); }, st[0]); }); }

  // ---- per-event voices: every event dispatches ['@fn', key] to an FX[] voice
  //   built on synth()/chord()/noiseHit()/thump(); crowd stays a flat fallback. --
  var SFX = {
    ui:      ['@fn', 'ui'],       // crisp FM tick — incidental
    snap:    ['@fn', 'snap'],     // leather PAP: FM thock + noise pop + sub
    open:    ['@fn', 'open'],     // window opens: bright FM ping up + reverb
    throw:   ['@fn', 'throw'],    // FM zip up + airy whip
    catch:   ['@fn', 'catch'],    // FM grab pop + contact tick + reverb
    first:   ['@fn', 'first'],    // fat 2-note FM arpeggio + reverb
    sack:    ['@fn', 'sack'],     // noise crack + distorted FM brass blat + sub
    int:     ['@fn', 'int'],      // pick crash + gut sub, then a runback arp
    td:      ['@fn', 'td'],       // big FM brass chord stab + sub boom + sparkle
    win:     ['@fn', 'win'],      // grand ascending FM fanfare + triad, long verb
    loss:    ['@fn', 'loss'],     // deflating descending minor FM "wah"
    hurry:   ['@fn', 'hurry'],    // anxious detuned FM wobble that sinks
    pbu:     ['@fn', 'pbu'],      // metallic FM clang + low knock
    whistle: ['@fn', 'whistle'],  // blown-metal FM tweet + air
    crowd:   [.7, .2, 500, .6, .9, .6, 4, .5, , , , , , 2, , , .3, .5, .4, .3]  // fallback; crowd() is the real one
  };

  var FX = {
    ui: function () {
      synth({ f: 1200, type: 'square', fm: { ratio: 3, index: 0.6, decay: 0.1 }, a: .001, d: .012, s: .08, r: .015, dur: .008, vol: .18 });
    },
    snap: function () {
      if (playSample('snap')) return;                 // the recorded "hut!" (else the procedural snap)
      synth({ f: 150, type: 'square', fm: { ratio: 1.5, index: 3, decay: 0.05 }, slideTo: 90, slideDur: 0.05, a: .002, d: .03, s: .2, r: .04, dur: .03, vol: .34, filt: { f0: 2200, f1: 400, q: 1 } });
      noiseHit(1900, 1.0, 'bandpass', 0.04, 0.40);
      thump(120, 70, 0.05, 0.34);
    },
    open: function () {
      synth({ f: 660, type: 'triangle', fm: { ratio: 3, index: 1.2, decay: 0.3 }, slideTo: 880, slideDur: 0.05, a: .003, d: .04, s: .3, r: .12, dur: .05, vol: .24, send: .25 });
    },
    throw: function () {
      synth({ f: 300, type: 'sawtooth', fm: { ratio: 2, index: 2, decay: 0.4 }, slideTo: 720, slideDur: 0.1, a: .005, d: .05, s: .3, r: .06, dur: .08, vol: .26, filt: { f0: 1200, f1: 4000, q: 2 }, send: .12 });
      noiseHit(1400, 1.2, 'bandpass', 0.10, 0.22, [1800, 700]);
    },
    catch: function () {
      if (playSample('catch')) return;                // the recorded ball-on-pads (else the procedural thwack)
      synth({ f: 480, type: 'triangle', fm: { ratio: 2, index: 1.8, decay: 0.25 }, slideTo: 640, slideDur: 0.04, a: .003, d: .05, s: .35, r: .1, dur: .07, vol: .22, send: .18 });
      leatherCatch();
    },
    first: function () {
      synth({ f: 784, type: 'sawtooth', uni: [-7, 7], fm: { ratio: 1, index: 2, decay: 0.3 }, a: .004, d: .05, s: .5, r: .1, dur: .08, vol: .26, filt: { f0: 4000, f1: 2000, q: 2 }, send: .25 });
      setTimeout(function () { synth({ f: 1047, type: 'sawtooth', uni: [-7, 7], fm: { ratio: 1, index: 2.4, decay: 0.3 }, a: .004, d: .07, s: .6, r: .18, dur: .16, vol: .28, filt: { f0: 5000, f1: 2200, q: 2 }, send: .35 }); }, 75);
    },
    sack: function () {
      if (playSample('hit', 1)) { setTimeout(grunt, 70); return; }   // recorded hit + the QB grunt
      noiseHit(850, 1.6, 'bandpass', 0.07, 0.50);
      synth({ f: 170, type: 'sawtooth', fm: { ratio: 1.4, index: 4.5, decay: 0.12 }, slideTo: 65, slideDur: 0.16, a: .002, d: .04, s: .25, r: .1, dur: .1, vol: .4, filt: { f0: 1800, f1: 180, q: 4 }, dist: .45, send: .12 });
      thump(150, 40, 0.18, 0.6);
      setTimeout(function () { thump(90, 42, 0.15, 0.45); noiseHit(150, 3.5, 'bandpass', 0.07, 0.26); }, 30);  // body hits the turf
      setTimeout(grunt, 30);                                                                                    // the QB grunts
    },
    int: function () {
      synth({ f: 440, type: 'sawtooth', fm: { ratio: 1.5, index: 3, decay: 0.2 }, slideTo: 120, slideDur: 0.18, a: .004, d: .06, s: .3, r: .12, dur: .12, vol: .34, filt: { f0: 2400, f1: 300, q: 3 }, dist: .3, send: .15 });
      noiseHit(3000, 1.0, 'highpass', 0.05, 0.28);
      thump(180, 50, 0.16, 0.5);
      arp([[170, 659], [240, 880], [310, 1175]], { type: 'sawtooth', uni: [-6, 6], fm: { ratio: 1, index: 2, decay: 0.3 }, a: .004, d: .05, s: .5, r: .12, dur: .08, vol: .24, send: .3 });
    },
    td: function () {
      chord([523, 659, 784, 1047], { type: 'sawtooth', uni: [-10, 10], fm: { ratio: 1, index: 2.8, decay: 0.35 }, a: .006, d: .1, s: .8, r: .4, dur: .35, vol: .2, filt: { f0: 5000, f1: 2000, q: 2 }, send: .4 });
      thump(110, 82, 0.5, 0.45);
      setTimeout(function () { noiseHit(7000, 0.7, 'highpass', 0.18, 0.16); }, 60);
    },
    win: function () {
      arp([[0, 523], [90, 659], [180, 784], [270, 1047]], { type: 'sawtooth', uni: [-9, 9], fm: { ratio: 1, index: 2.5, decay: 0.3 }, a: .005, d: .06, s: .7, r: .14, dur: .12, vol: .26, filt: { f0: 4500, f1: 2000, q: 3 }, send: .3 });
      setTimeout(function () { chord([1319, 1047, 659], { type: 'sawtooth', uni: [-10, 10], fm: { ratio: 1, index: 3, decay: 0.4 }, a: .006, d: .1, s: .9, r: .6, dur: .5, vol: .2, filt: { f0: 6000, f1: 2600, q: 2 }, send: .5 }); }, 380);
      thump(98, 98, 0.8, 0.4);
    },
    loss: function () {
      synth({ f: 392, type: 'sawtooth', fm: { ratio: 1, index: 1.5, decay: 0.5 }, slideTo: 330, slideDur: 0.2, a: .01, d: .1, s: .5, r: .2, dur: .2, vol: .3, filt: { f0: 1600, f1: 500, q: 2 }, send: .3 });
      setTimeout(function () { synth({ f: 311, type: 'sawtooth', fm: { ratio: 1, index: 1.5, decay: 0.5 }, slideTo: 247, slideDur: 0.3, a: .01, d: .14, s: .45, r: .3, dur: .3, vol: .3, filt: { f0: 1300, f1: 380, q: 2 }, send: .35 }); }, 175);
    },
    hurry: function () {
      synth({ f: 200, type: 'square', uni: [-14, 14], fm: { ratio: 1.01, index: 2, decay: 0.6 }, slideTo: 150, slideDur: 0.15, a: .005, d: .05, s: .5, r: .08, dur: .12, vol: .28, filt: { f0: 1400, f1: 600, q: 5 } });
    },
    pbu: function () {
      synth({ f: 520, type: 'square', fm: { ratio: 5.4, index: 3, decay: 0.1 }, a: .002, d: .04, s: .15, r: .06, dur: .05, vol: .3, send: .2 });
      synth({ f: 300, type: 'sawtooth', fm: { ratio: 1.5, index: 2, decay: 0.1 }, slideTo: 180, slideDur: 0.06, a: .002, d: .03, s: .2, r: .05, dur: .05, vol: .26, dist: .2 });
    },
    whistle: function () {
      if (playSample('whistle')) return;              // the recorded ref whistle
      synth({ f: 2100, type: 'sine', fm: { ratio: 1.005, index: 0.5, decay: 0.8 }, a: .02, d: .05, s: .8, r: .05, dur: .18, vol: .26, send: .15 });
      noiseHit(3400, 1.5, 'bandpass', 0.18, 0.06);
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
      loadSamples();                  // kick off the recorded-clip loads on the first gesture
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
    if (kind === 'erupt' && playSample('cheer', 0.9, 5)) return;   // the recorded TD roar (capped at 5s)
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

  // fanfare: the melodic ascending FM brass run (C-E-G-C) layered over the FX.td
  // chord stab on a score — detuned unison + filter env + reverb = a 16-bit call.
  function fanfare() {
    arp([[0, 523], [90, 659], [180, 784]], { type: 'sawtooth', uni: [-8, 8], fm: { ratio: 1, index: 2.2, decay: 0.3 }, a: .005, d: .05, s: .65, r: .14, dur: .12, vol: .22, filt: { f0: 4200, f1: 1800, q: 3 }, send: .3 });
    setTimeout(function () { synth({ f: 1047, type: 'sawtooth', uni: [-11, 0, 11], fm: { ratio: 1, index: 2.8, decay: 0.35 }, a: .005, d: .08, s: .85, r: .45, dur: .32, vol: .24, filt: { f0: 5200, f1: 2200, q: 2 }, send: .5 }); }, 270);
  }

  // whoosh: an FM riser for a big gainer — saw+FM sweeping up through an opening
  // lowpass + a rising bandpass-noise air bed. Upward = lift.
  function whoosh() {
    synth({ f: 180, type: 'sawtooth', uni: [-6, 6], fm: { ratio: 1.5, index: 1.5, decay: 1.5 }, slideTo: 760, slideDur: 0.34, a: .02, d: .1, s: .7, r: .12, dur: .26, vol: .26, filt: { f0: 500, f1: 4500, q: 2 }, send: .2 });
    noiseHit(900, 1.0, 'bandpass', 0.32, 0.16, [400, 1900]);
  }

  // ding: a bright FM coin 2-note up-bling (micro-reward building block).
  function ding() {
    synth({ f: 880, type: 'square', fm: { ratio: 2, index: 1, decay: 0.3 }, a: .003, d: .04, s: .3, r: .08, dur: .04, vol: .24, send: .2 });
    setTimeout(function () { synth({ f: 1320, type: 'square', fm: { ratio: 2, index: 1.2, decay: 0.3 }, a: .003, d: .05, s: .4, r: .12, dur: .1, vol: .26, send: .3 }); }, 75);
  }

  // ---- organic football SFX: formant voices (grunt/crowd) + foley impacts -----
  //   from a procedural-audio research sprint. formant() is the new primitive:
  //   a buzz(+noise) source through a PARALLEL bandpass formant bank = a vowel.
  function rnd(a, b) { return a + Math.random() * (b - a); }
  var FORMANTS = {                                  // male vowels: [centerHz, Q, relGain]
    uh: [[640, 7, 1.0], [1190, 11, 0.45], [2390, 24, 0.20]],   // grunt
    aw: [[570, 7, 1.0], [840, 11, 0.70], [2410, 20, 0.20]],    // groan / ohh
    ah: [[730, 7, 1.0], [1090, 11, 0.50], [2440, 20, 0.22]]    // gasp
  };
  function formant(o) {
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime, sr = c.sampleRate;
      var f0 = o.f0 || 120, dur = o.dur || 0.2, vol = o.vol == null ? 0.25 : o.vol,
          a = o.a || 0.01, d = o.d || 0.05, s = o.s == null ? 0.5 : o.s, r = o.r || 0.1,
          end = t + a + d + dur, stop = end + r + 0.05, spread = o.jitter == null ? 0.05 : o.jitter;
      var table = FORMANTS[o.vowel] || FORMANTS.uh;
      var amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + a);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * s), t + a + d);
      amp.gain.setValueAtTime(Math.max(0.0001, vol * s), end);
      amp.gain.exponentialRampToValueAtTime(0.0001, end + r);
      amp.connect(busIn());
      if (o.send) { var sg = c.createGain(); sg.gain.value = o.send; amp.connect(sg); sg.connect(reverbIn()); }
      var src = c.createGain(); src.gain.value = 1;
      var osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + dur);
      osc.connect(src); osc.start(t); osc.stop(stop);
      if (o.noiseMix) {                              // larynx grit / breath = the organic edge
        var nlen = Math.max(1, (sr * (dur + a + d + r)) | 0), nb = c.createBuffer(1, nlen, sr), nd = nb.getChannelData(0);
        for (var i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
        var ns = c.createBufferSource(); ns.buffer = nb;
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; hp.Q.value = 0.5;
        var ng = c.createGain(); ng.gain.value = o.noiseMix;
        ns.connect(hp); hp.connect(ng); ng.connect(src); ns.start(t); ns.stop(stop);
      }
      table.forEach(function (fm) {                  // parallel bandpass bank (sum, not cascade)
        var bp = c.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = fm[0] * (1 + (Math.random() * 2 - 1) * spread); bp.Q.value = fm[1];
        var fg = c.createGain(); fg.gain.value = fm[2];
        src.connect(bp); bp.connect(fg); fg.connect(amp);
      });
    } catch (e) {}
  }
  function grunt() {                                 // QB effort vocalization, masked under the sack thump
    formant({ vowel: Math.random() < 0.5 ? 'uh' : 'ah', f0: 150 * rnd(0.88, 1.12), slideTo: 95 * rnd(0.9, 1.05),
      dur: 0.20 * rnd(0.85, 1.15), vol: 0.30, a: 0.008, d: 0.05, s: 0.45, r: 0.10, noiseMix: 0.24, send: 0.10 });
  }
  function tackle(big) {                             // dark body-on-body impact; big = gang-tackle crunch
    if (muted || typeof zzfxX === 'undefined') return;
    if (playSample('hit', big ? 1 : 0.85)) return;   // the recorded hit (else the procedural thud)
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime, sr = c.sampleRate, dur = 0.16,
          n = Math.max(1, (sr * dur) | 0), b = c.createBuffer(1, n, sr), dd = b.getChannelData(0);
      for (var i = 0; i < n; i++) dd[i] = Math.random() * 2 - 1;
      var ws = c.createBufferSource(); ws.buffer = b;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
      lp.frequency.setValueAtTime(1600 * rnd(0.9, 1.1), t);
      lp.frequency.exponentialRampToValueAtTime(110, t + dur);            // highs removed => heavy/soft, not a crack
      var wg = c.createGain(); wg.gain.setValueAtTime(big ? 0.5 : 0.42, t); wg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      ws.connect(lp); lp.connect(wg); wg.connect(busIn()); ws.start(t); ws.stop(t + dur);
    } catch (e) {}
    if (big) {
      thump(90, 45, 0.18, 0.6);
      noiseHit(170 * rnd(0.95, 1.06), 3.5, 'bandpass', 0.06, 0.30);
      setTimeout(function () { noiseHit(150 * rnd(0.95, 1.06), 3.0, 'bandpass', 0.06, 0.24); }, 12);
      setTimeout(function () { noiseHit(140 * rnd(0.95, 1.06), 3.0, 'bandpass', 0.05, 0.20); }, 24);
    } else {
      thump(95 * rnd(0.95, 1.06), 45, 0.16, 0.55);
      noiseHit(160 * rnd(0.95, 1.08), 3.5, 'bandpass', 0.07, 0.34);
    }
  }
  function leatherCatch() {                          // crisp ball-on-pads thwack — 4 synchronous layers
    if (muted || typeof zzfxX === 'undefined') return;
    ensureUnlock();
    noiseHit(2900 * rnd(0.94, 1.06), 1.2, 'highpass', 0.018, 0.34, [2900, 6500]);  // bright leather slap
    noiseHit(2000 * rnd(0.95, 1.05), 1.4, 'bandpass', 0.03, 0.22);                 // upper-mid leather pop
    noiseHit(240 * rnd(0.96, 1.05), 5.0, 'bandpass', 0.05, 0.30);                  // 240Hz modal pad-thunk
    thump(180, 120, 0.055, 0.28);                                                  // faint chest tick
  }
  function crowdOhh(loud) {                          // disappointed falling 'ohhh': groan bed + low /ɔ/ formant voices
    if (muted || typeof zzfxX === 'undefined') return;
    if (playSample('ohh', loud ? 1 : 0.85, 4)) return;   // the recorded crowd 'ohhh' (capped at 4s)
    crowd('groan');                                  // the noise bed = the size
    var pitches = [92, 98, 110, 124, 131, 103], v = loud ? 0.07 : 0.055;
    pitches.forEach(function (p) {
      formant({ vowel: 'aw', f0: p * rnd(0.96, 1.04), slideTo: p * 0.92, dur: 0.95 * rnd(0.9, 1.1),
        vol: v, a: 0.12, d: 0.2, s: 0.7, r: 0.4, noiseMix: 0.55, send: 0.25, jitter: 0.08 });   // noise-heavy = breath, not organ
    });
  }
  function crowdGasp() {                             // the crowd's groan on an interception
    if (muted || typeof zzfxX === 'undefined') return;
    if (playSample('ohh', 1, 4)) return;             // the recorded crowd 'ohhh' at full volume — a turnover hurts
    noiseHit(1200, 0.8, 'bandpass', 0.18, 0.12, [600, 1800]);    // the collective inhale
    [110, 131, 165, 123, 98, 147, 175].forEach(function (p) {    // open /a/, fast attack = everyone at once
      formant({ vowel: 'ah', f0: p * rnd(0.85, 1.15), slideTo: p * 0.9, dur: 1.25 * rnd(0.9, 1.1),
        vol: 0.06, a: 0.02, d: 0.15, s: 0.8, r: 0.5, noiseMix: 0.50, send: 0.3, jitter: 0.08 });
    });
    crowd('groan');                                  // the sinking bed
    thump(180, 55, 0.5, 0.22);                        // the gut-drop
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
    if (muted) crowdBedStop();
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

  // ---------- ambient crowd bed (recorded crowd loops, layered) ----------
  //   Two real crowd recordings looped + layered (offset so they don't phase-align)
  //   for a continuous stadium hum — decoded with the other clips. Starts once the
  //   clips have loaded (idempotent, retried each setStage); stops on gameover/mute.
  var CROWD_LOW = 0.15, CROWD_PLAY = 0.5, CROWD_SWELL = 0.72;   // resting / during-play / completion-swell (tune here)
  var _crowdBed = null;
  function crowdBedStart() {
    if (muted || typeof zzfxX === 'undefined' || _crowdBed) return;
    var bufs = (SAMPLES.ambient || []).filter(Boolean);
    if (!bufs.length) return;         // not decoded yet -> retry on the next call
    ensureUnlock();
    try {
      var c = zzfxX, t = c.currentTime;
      var g = c.createGain(); g.gain.value = 0.0001; g.connect(busIn());
      g.gain.linearRampToValueAtTime(CROWD_LOW, t + 1.2);              // fade in to the resting level
      var per = bufs.length > 1 ? 0.7 : 1.0;                            // don't double up when layering
      var nodes = bufs.map(function (buf, i) {
        var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        var sg = c.createGain(); sg.gain.value = per;
        src.connect(sg); sg.connect(g);
        src.start(t + i * 0.17, buf.duration > 2 ? Math.random() * (buf.duration - 1) : 0);   // begin mid-clip = a different section each game
        return src;
      });
      _crowdBed = { g: g, nodes: nodes };
    } catch (e) {}
  }
  function crowdBedStop() {
    if (!_crowdBed) return;
    try {
      var c = zzfxX, t = c.currentTime, b = _crowdBed;
      b.g.gain.cancelScheduledValues(t); b.g.gain.setValueAtTime(Math.max(0.0001, b.g.gain.value), t);
      b.g.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      var st = t + 0.45;
      b.nodes.forEach(function (n) { try { n.stop(st); } catch (e) {} });
    } catch (e) {}
    _crowdBed = null;
  }
  // crowdLevel(kind): ramp the bed for the game phase — 'low' while you pick a play,
  // 'play' while the play runs, 'swell' = a reaction pop then settle on a completion.
  function crowdLevel(kind) {
    if (!_crowdBed || typeof zzfxX === 'undefined') return;
    try {
      var g = _crowdBed.g.gain, t = zzfxX.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.0001, g.value), t);
      if (kind === 'play') g.linearRampToValueAtTime(CROWD_PLAY, t + 0.4);                                              // the play is live — crowd up
      else if (kind === 'swell') { g.linearRampToValueAtTime(CROWD_SWELL, t + 0.2); g.linearRampToValueAtTime(CROWD_LOW, t + 1.8); }  // a pop on a catch, then settle
      else g.linearRampToValueAtTime(CROWD_LOW, t + 0.9);                                                               // selection / between plays
    } catch (e) {}
  }

  root.Sound = { sfx: sfx, crowd: crowd, fanfare: fanfare, whoosh: whoosh, ding: ding, announce: announce, setMuted: setMuted, isMuted: isMuted, ensureUnlock: ensureUnlock, grunt: grunt, tackle: tackle, leatherCatch: leatherCatch, crowdOhh: crowdOhh, crowdGasp: crowdGasp, formant: formant, crowdBedStart: crowdBedStart, crowdBedStop: crowdBedStop, crowdLevel: crowdLevel };
})(window);
