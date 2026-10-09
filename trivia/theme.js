/* Asher Arcade Trivia: turn any two colors into a readable game theme.
 *
 * Customers pick a primary and a secondary color (school colors, party
 * colors). Whatever they pick, the game has to stay readable: white text on
 * the background, dark text on the highlight buttons, and the highlight has
 * to stand out from the background.
 *
 * The darker of the two colors becomes the background, darkened until white
 * text on it passes 10:1 contrast. The lighter one becomes the highlight,
 * lightened until dark text on it passes 7:1 and it reads at 4.5:1 against
 * the background. Hue is kept, so blue stays blue, just deeper or brighter.
 *
 * Used by trivia.html, order.html and trivia-studio.html. Tested by
 * apps-script-trivia/test.js.
 */
(function (root) {
  'use strict';
  var INK = '#1a1033';   // dark text used on light surfaces
  var WHITE = '#ffffff';

  function rgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }
  function hex(c) {
    return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join('');
  }
  function lum(c) {
    var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) {
    var x = lum(typeof a === 'string' ? rgb(a) : a), y = lum(typeof b === 'string' ? rgb(b) : b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function mix(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }

  // Step toward `to` until test() passes (always ends at `to`, which passes).
  function push(c, to, test) {
    for (var t = 0; t <= 1.0001; t += 0.02) {
      var m = mix(c, to, t);
      if (test(m)) return m;
    }
    return to;
  }

  function makeTheme(primary, secondary) {
    var a = rgb(primary) || rgb('#1b3f80'), b = rgb(secondary) || rgb('#f2c14e');
    var dark = lum(a) <= lum(b) ? a : b, light = dark === a ? b : a;
    var black = [0, 0, 0], white = [255, 255, 255], ink = rgb(INK);

    var bg1 = push(dark, black, function (c) { return contrast(c, white) >= 10; });
    // The glow keeps more of the color but still holds white text at 7:1.
    // Near-black backgrounds borrow a little of the other color so the glow shows.
    var base = lum(dark) < 0.02 ? mix(dark, light, 0.25) : dark;
    var bg2 = push(base, black, function (c) { return contrast(c, white) >= 7; });
    var accent = push(light, white, function (c) { return contrast(c, ink) >= 7 && contrast(c, bg1) >= 4.5; });
    return { bg1: hex(bg1), bg2: hex(bg2), accent: hex(accent) };
  }

  // Best text color (white or dark ink) for a colored surface.
  function textOn(bg) { return contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK; }

  var api = { makeTheme: makeTheme, contrast: contrast, textOn: textOn, INK: INK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TriviaTheme = api;
})(this);
