'use strict';
// Derives a full theme palette (the same ~25 colour variables every built-in
// `:root[data-theme="x"]` block in styles.css defines) from three seed colours
// (background, foreground, accent), the way the 9 hand-tuned built-in themes
// were designed, but automatically: surfaces are stepped off the background,
// muted/faint text is interpolated between foreground and background, and
// every text-role colour (fg, muted, err, warn, ok, accent, info) is nudged in
// lightness - hue and saturation left alone - until it clears the same 4.5:1
// WCAG bar test/theme.test.js already holds the built-in themes to against
// bg/bg-2/bg-3, or as close to it as that hue/saturation can reach.
const { contrast } = require('./contrast');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

function hexToRgb(hex) {
  const n = hex.replace('#', '');
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => (v + m) * 255);
}
const hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
const hslToHex = (h, s, l) => rgbToHex(hslToRgb(h, s, l));
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;

// Walks lightness away from `start`, in direction `dir` (+1 lighter, -1 darker),
// stopping at the first value that clears `minRatio` against every colour in
// `bgs`. Falls back to whichever step got closest if the hue/saturation simply
// can't reach the bar in that direction - the "clamp to the closest achievable
// value" case.
function solveLightness(h, s, start, dir, bgs, minRatio = 4.5) {
  let best = null, bestMin = -1;
  const end = dir > 0 ? 0.98 : 0.02;
  for (let l = start; dir > 0 ? l <= end : l >= end; l += dir * 0.01) {
    const hex = hslToHex(h, s, clamp(l, 0, 1));
    const minC = Math.min(...bgs.map((bg) => contrast(hex, bg)));
    if (minC > bestMin) { bestMin = minC; best = hex; }
    if (minC >= minRatio) return hex;
  }
  return best;
}

const SEMANTIC_HUES = { err: 355, warn: 42, ok: 142 };

function deriveTheme({ bg, fg, accent, dark }) {
  const [, , bgL] = hexToHsl(bg);
  const [fgH, fgS, fgL0] = hexToHsl(fg);
  const isDark = dark === undefined ? bgL < 0.5 : !!dark;
  const dir = fgL0 >= bgL ? 1 : -1; // which way is "away from bg" for text colours

  const fgFixed = solveLightness(fgH, fgS, fgL0, dir, [bg]);
  const [, , fgL] = hexToHsl(fgFixed);

  const [accH, accS, accL0] = hexToHsl(accent);

  // surfaces: step bg's own lightness toward fg, borrowing accent's hue when
  // bg is close to neutral/black so stepped surfaces pick up a tint (the same
  // effect nerd/tron/wargames get from a black bg with a saturated accent)
  const [bgH0, bgS0] = hexToHsl(bg);
  const surfaceHue = bgS0 < 0.08 ? accH : bgH0;
  const surfaceSat = Math.max(bgS0, accS * 0.25);
  const bg2 = hslToHex(surfaceHue, surfaceSat, clamp(bgL + dir * 0.035, 0, 1));
  const bg3 = hslToHex(surfaceHue, surfaceSat, clamp(bgL + dir * 0.075, 0, 1));
  const line = mix(bg3, fgFixed, 0.18);

  const mutedStart = bgL + (fgL - bgL) * 0.55;
  const faintStart = bgL + (fgL - bgL) * 0.3;
  const muted = solveLightness(fgH, fgS * 0.75, mutedStart, dir, [bg, bg2, bg3]);
  const faint = hslToHex(fgH, fgS * 0.6, clamp(faintStart, 0, 1));

  const role = (h, s) => solveLightness(h, s, fgL, dir, [bg, bg2, bg3]);
  const accentFixed = role(accH, accS);
  const err = role(SEMANTIC_HUES.err, 0.75);
  const warn = role(SEMANTIC_HUES.warn, 0.7);
  const ok = role(SEMANTIC_HUES.ok, 0.55);
  const info = accentFixed; // every built-in theme but light/high-contrast-light sets info = accent

  const vars = {
    '--bg': bg,
    '--bg-2': bg2,
    '--bg-3': bg3,
    '--line': line,
    '--fg': fgFixed,
    '--muted': muted,
    '--faint': faint,
    '--accent': accentFixed,
    '--err': err,
    '--warn': warn,
    '--info': info,
    '--ok': ok,
    '--accent-bg': mix(accentFixed, bg, 0.62),
    '--accent-line': mix(accentFixed, bg, 0.42),
    '--danger-line': mix(err, bg, 0.55),
    '--err-bg': mix(err, bg, 0.82),
    '--warn-bg': mix(warn, bg, 0.82),
    '--ok-bg': mix(ok, bg, 0.82),
    '--info-bg': mix(info, bg, 0.82),
    '--g0': accentFixed,
    '--g1': ok,
    '--g2': warn,
    '--g3': hslToHex((accH + 120) % 360, accS, accL0),
    '--g4': err,
    '--g5': hslToHex((accH + 240) % 360, accS, accL0),
    '--overlay': rgba(mix(fgFixed, '#000000', 0.9), isDark ? 0.5 : 0.35),
    '--shadow': rgba(mix(fgFixed, '#000000', 0.9), isDark ? 0.6 : 0.25),
  };
  return { dark: isDark, vars };
}

const TEXT_ROLES = ['--fg', '--muted', '--err', '--warn', '--ok', '--accent', '--info'];
const BG_ROLES = ['--bg', '--bg-2', '--bg-3'];

function contrastReport(vars) {
  const pairs = [];
  for (const bg of BG_ROLES) {
    for (const fg of TEXT_ROLES) {
      const ratio = contrast(vars[fg], vars[bg]);
      pairs.push({ fg, bg, ratio, pass: ratio >= 4.5 });
    }
  }
  return { pairs, allPass: pairs.every((p) => p.pass) };
}

module.exports = { deriveTheme, contrastReport, hexToHsl, hslToHex, mix };
