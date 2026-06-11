// Tactical Football — procedural 8-bit player portraits.
// Hand-tuned pixel busts drawn on a 16x18 grid at runtime — no image assets,
// matching the all-procedural art direction. Each named player gets a LOOK
// (skin tone, brow attitude, facial hair, eye black, visor, helmet stripe) so
// the roster reads as twelve different people at a glance. Rendered to a tiny
// canvas and CSS-scaled with image-rendering:pixelated for the crisp NES look.
(function (root) {
  'use strict';

  var W = 16, H = 18;
  var TEAM = {
    off: { shell: '#0078f8', shade: '#103cb0' },   // NES blue (matches the chips)
    def: { shell: '#f83800', shade: '#a01000' },   // NES red
  };
  var SKIN = [
    { base: '#f8d0a0', shade: '#d8a878' },
    { base: '#e8b488', shade: '#c08858' },
    { base: '#c08050', shade: '#985c30' },
    { base: '#8a5430', shade: '#683a1c' },
    { base: '#5e3a22', shade: '#402414' },
  ];
  var INK = '#181818', HAIR = '#241006', MASK = '#d8d8d8', WHITE = '#fcfcfc';
  var VISOR = '#16263c', GLINT = '#8cb0d8';

  // brow: 0 flat / 1 scowl (angled in-down) / 2 raised. jaw: 0 clean / 1 mustache /
  // 2 beard / 3 goatee. eb: eye black. visor: mirrored shield (hides the eyes).
  var LOOKS = {
    qb:   { skin: 1, brow: 0, jaw: 0, eb: 0, stripe: 1 },             // J. Vance — the clean-cut field general
    x:    { skin: 3, brow: 1, jaw: 0, eb: 1, stripe: 0 },             // D. Hart — game face + eye black
    z:    { skin: 2, brow: 0, jaw: 1, eb: 0, stripe: 0 },             // T. Ruiz — the mustache
    slot: { skin: 0, brow: 2, jaw: 0, eb: 1, stripe: 0 },             // C. Reed — wide-eyed and shifty
    te:   { skin: 0, brow: 0, jaw: 2, eb: 0, stripe: 2 },             // G. Olsen — lumberjack beard
    rb:   { skin: 4, brow: 1, jaw: 3, eb: 1, stripe: 1 },             // A. Kane — goateed hammer
    cbX:  { skin: 3, brow: 0, jaw: 0, eb: 0, stripe: 1, visor: 1 },   // R. Slade — mirrored visor, says nothing
    cbZ:  { skin: 1, brow: 0, jaw: 1, eb: 0, stripe: 0 },             // M. Pope
    nb:   { skin: 4, brow: 1, jaw: 0, eb: 0, stripe: 0 },             // M. Diallo
    ss:   { skin: 2, brow: 1, jaw: 3, eb: 1, stripe: 0 },             // B. Cole — downhill scowl
    mlb:  { skin: 1, brow: 1, jaw: 2, eb: 1, stripe: 2 },             // F. Boone — the bearded enforcer
    fs:   { skin: 0, brow: 2, jaw: 0, eb: 0, stripe: 1 },             // D. Park — eyes everywhere
  };
  var GENERIC = { skin: 2, brow: 0, jaw: 0, eb: 0, stripe: 0 };       // linemen / unknown keys

  function bust(o) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
    function px(x, y, col) { rect(x, y, 1, 1, col); }
    var T = TEAM[o.team] || TEAM.off, S = SKIN[o.skin] || SKIN[2];

    // shoulder pads + jersey
    rect(1, 14, 14, 1, T.shell);
    rect(0, 15, 16, 3, T.shell);
    rect(0, 15, 2, 3, T.shade); rect(14, 15, 2, 3, T.shade);   // arm rounding
    rect(2, 17, 12, 1, T.shade);                                // bottom roll-off
    rect(6, 14, 4, 1, WHITE);                                   // collar
    // neck
    rect(6, 12, 4, 2, S.shade);
    // helmet shell
    rect(4, 0, 8, 1, T.shell);
    rect(3, 1, 10, 1, T.shell);
    rect(2, 2, 12, 2, T.shell);
    rect(2, 4, 2, 8, T.shell);   // left side down to the jaw flap
    rect(12, 4, 2, 8, T.shell);
    rect(2, 10, 2, 2, T.shade); rect(12, 10, 2, 2, T.shade);   // jaw-flap shading
    px(2, 2, T.shade); px(13, 2, T.shade);                      // dome curve
    if (o.stripe >= 1) rect(7, 0, 2, 4, WHITE);                 // center stripe
    if (o.stripe === 2) { rect(5, 1, 1, 3, WHITE); rect(10, 1, 1, 3, WHITE); }
    px(3, 7, T.shade);                                          // ear hole
    // face
    rect(4, 4, 8, 8, S.base);
    rect(4, 4, 8, 1, S.shade);                                  // helmet shadow on the brow line
    if (o.visor) {
      rect(4, 5, 8, 4, VISOR);                                  // mirrored shield
      rect(5, 6, 2, 1, GLINT); px(10, 7, GLINT);                // glints
    } else {
      if (o.brow === 1) {        // scowl — outer ends high, inner ends low
        px(4, 5, HAIR); px(5, 5, HAIR); px(6, 6, HAIR);
        px(11, 5, HAIR); px(10, 5, HAIR); px(9, 6, HAIR);
      } else {
        var by = o.brow === 2 ? 5 : 6;
        rect(5, by, 2, 1, HAIR); rect(9, by, 2, 1, HAIR);
      }
      rect(5, 7, 2, 1, INK); rect(9, 7, 2, 1, INK);             // eyes
      if (o.eb) { rect(5, 8, 2, 1, INK); rect(9, 8, 2, 1, INK); }  // eye black
    }
    px(8, 8, S.shade); px(8, 9, S.shade);                       // nose line
    // mouth row (visible through the facemask gap) + facial hair
    if (o.jaw === 1) rect(5, 10, 6, 1, HAIR);                                 // mustache
    else if (o.jaw === 2) { rect(4, 10, 8, 1, HAIR); px(4, 8, HAIR); px(11, 8, HAIR); px(4, 9, HAIR); px(11, 9, HAIR); }  // beard + sideburns
    else if (o.jaw === 3) { rect(6, 10, 4, 1, HAIR); }                        // goatee
    else rect(7, 10, 2, 1, S.shade);                                          // plain mouth
    // facemask (drawn last — it sits in front)
    rect(3, 9, 10, 1, MASK);
    rect(3, 11, 10, 1, MASK);
    rect(3, 9, 1, 3, MASK); rect(12, 9, 1, 3, MASK);
    return c;
  }

  // canvas(simKey, team, scale) -> a ready-to-insert <canvas class="pix-portrait">
  function canvas(simKey, team, scale) {
    var look = LOOKS[simKey] || GENERIC;
    var c = bust({ skin: look.skin, brow: look.brow, jaw: look.jaw, eb: look.eb,
                   stripe: look.stripe || 0, visor: look.visor || 0, team: team || 'off' });
    c.className = 'pix-portrait';
    var s = scale || 3;
    c.style.width = (W * s) + 'px';
    c.style.height = (H * s) + 'px';
    return c;
  }

  root.Portraits = { canvas: canvas, LOOKS: LOOKS };
})(typeof window !== 'undefined' ? window : this);
