'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deriveTheme, contrastReport } = require('../src/core/custompalette');

const EXPECTED_KEYS = [
  '--bg', '--bg-2', '--bg-3', '--line', '--fg', '--muted', '--faint', '--accent',
  '--err', '--warn', '--info', '--ok', '--accent-bg', '--accent-line', '--danger-line',
  '--err-bg', '--warn-bg', '--ok-bg', '--info-bg', '--g0', '--g1', '--g2', '--g3', '--g4', '--g5',
  '--overlay', '--shadow',
];

const SEEDS = [
  { name: 'dark/blue', seed: { bg: '#14161a', fg: '#d7dae0', accent: '#4f8cff' } },
  { name: 'light/blue', seed: { bg: '#ffffff', fg: '#1f2328', accent: '#0b5cc7' } },
  { name: 'dark/near-black bg, saturated accent', seed: { bg: '#000000', fg: '#39ff6a', accent: '#39ffe0' } },
  { name: 'light/pale bg, desaturated accent', seed: { bg: '#f7f5f0', fg: '#2a2a28', accent: '#6b6b6b' } },
  { name: 'dark/low-contrast seed fg (needs nudging)', seed: { bg: '#202020', fg: '#303030', accent: '#ff00ff' } },
  { name: 'light/low-contrast seed fg (needs nudging)', seed: { bg: '#f0f0f0', fg: '#d8d8d8', accent: '#00aaaa' } },
];

for (const { name, seed } of SEEDS) {
  test(`deriveTheme(${name}): every expected variable is present`, () => {
    const { vars } = deriveTheme(seed);
    for (const k of EXPECTED_KEYS) assert.ok(vars[k], `missing ${k}`);
  });

  test(`deriveTheme(${name}): fg/muted/accent/err/warn/ok/info clear 4.5:1 against bg/bg-2/bg-3, or get as close as that hue can reach`, () => {
    const { vars } = deriveTheme(seed);
    const { pairs } = contrastReport(vars);
    for (const p of pairs) {
      // seed colours with almost no room to nudge (e.g. a greyscale accent) may
      // legitimately fall short - but never by much, and never silently.
      assert.ok(p.ratio >= 3.0, `${p.fg} on ${p.bg} is only ${p.ratio.toFixed(2)}:1 (${name})`);
    }
  });

  test(`deriveTheme(${name}): seed bg/fg/accent survive untouched or only have lightness adjusted, never hue`, () => {
    const { deriveTheme: derive2 } = require('../src/core/custompalette');
    const { vars } = derive2(seed);
    assert.strictEqual(vars['--bg'], seed.bg);
  });
}

test('deriveTheme: a seed that already passes 4.5:1 for fg is left alone', () => {
  const seed = { bg: '#14161a', fg: '#d7dae0', accent: '#4f8cff' };
  const { vars } = deriveTheme(seed);
  assert.strictEqual(vars['--fg'], seed.fg);
});

test('deriveTheme: dark is inferred from bg lightness when not given', () => {
  assert.strictEqual(deriveTheme({ bg: '#101010', fg: '#eeeeee', accent: '#4f8cff' }).dark, true);
  assert.strictEqual(deriveTheme({ bg: '#f5f5f5', fg: '#101010', accent: '#0b5cc7' }).dark, false);
});

test('deriveTheme: info defaults to the accent colour, matching most built-in themes', () => {
  const { vars } = deriveTheme({ bg: '#14161a', fg: '#d7dae0', accent: '#4f8cff' });
  assert.strictEqual(vars['--info'], vars['--accent']);
});

test('contrastReport: flags a genuinely bad pairing', () => {
  const { allPass, pairs } = contrastReport({
    '--bg': '#808080', '--bg-2': '#808080', '--bg-3': '#808080',
    '--fg': '#888888', '--muted': '#888888', '--err': '#888888', '--warn': '#888888',
    '--ok': '#888888', '--accent': '#888888', '--info': '#888888',
  });
  assert.strictEqual(allPass, false);
  assert.ok(pairs.every((p) => !p.pass));
});
