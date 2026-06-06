// sound.js — procedural arcade SFX + a speechSynthesis announcer for Tactical
// Football. Uses ZzFX (zzfx.js, loaded first). Zero audio assets. Mute is
// persisted to localStorage 'tf-sound'; audio unlocks on the player's first
// gesture. Everything is wrapped so it can never throw on the 60fps path.
(function (root) {
  'use strict';

  var muted = localStorage.getItem('tf-sound') === 'off';
  var unlocked = false;
  var mediaEl = null;

  // ---- ZzFX param sets per event (from the arcade A/V brief) ----
  var SFX = {
    ui:      [1, .05, 1200, , .01, .02, 1, 2, , , , , , , , , , .7, .01],
    snap:    [1.4, .05, 90, .01, , .12, 1, 1.5, , , , , , 5, , , .05],
    open:    [.6, .05, 660, , .02, .05, 1, 1.5, , , , , , , , , , .6, .02],
    throw:   [1, .05, 330, .02, .04, .1, 2, 1.6, 8, 90, , , , , , , , .6, .02],
    catch:   [1.1, .05, 520, .01, .03, .06, 1, 1.8, , , 150, .05, , , , , , .8, .02],
    first:   [1.2, .05, 700, .01, .05, .08, 1, 1.8, , , 180, .06, , , , , , .8, .02],
    sack:    [2, .1, 200, .03, .08, .3, 2, .7, -9, -30, , , , 1.5, , .6, .2, .5, .06],
    hurry:   [.7, .05, 150, .02, .03, .12, 2, .8, -4, , , , , 1, , .3, .1, .6, .04],
    pbu:     [1, .1, 400, , .02, .1, 3, 1, , , , , , 2, , .5, .1, .5, .03],
    int:     [1.6, .05, 440, .03, .1, .35, 2, 1.2, , , -180, .12, .08, , , .1, , .7, .05, .4],
    td:      [1.6, .05, 523, .05, .25, .5, 1, 1.3, , , 200, .06, .16, , , , , .8, .1],
    win:     [1.5, .05, 392, .04, .3, .5, 1, 1.4, , , 150, .05, .14, , , , , .9, .1],
    loss:    [1.4, .05, 300, .05, .1, .4, 2, 1, -3, , -40, .1, , , , , , .6, .08],
    crowd:   [.7, .2, 500, .6, .9, .6, 4, .5, , , , , , 2, , , .3, .5, .4, .3],
    whistle: [1, .05, 2100, .02, .18, .04, 0, .5, , , , , , , , , , .7, , .6]
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

  function sfx(name) {
    if (muted) return;
    ensureUnlock();
    var p = SFX[name];
    if (!p || typeof zzfx === 'undefined') return;
    try { zzfx.apply(null, p); } catch (e) {}
  }

  // ---- speechSynthesis announcer (the big beats only — NBA-Jam restraint) ----
  var PHRASES = {
    td:   ['Touchdown!', 'He could go all the way!', 'Boom! Six points!'],
    int:  ['Intercepted!', 'Picked off — he read it!', 'Oh, pick six!'],
    sack: ['Sacked!', 'Down goes the quarterback!', 'Got him!'],
    dime: ['Dime!', 'On the money!', 'What a read!'],
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

  function announce(kind) {
    if (muted || !hasSpeech) return;
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

  root.Sound = { sfx: sfx, announce: announce, setMuted: setMuted, isMuted: isMuted, ensureUnlock: ensureUnlock, musicStart: musicStart, musicStop: musicStop };
})(window);
