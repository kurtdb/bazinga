'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');

const block = (re) => { const m = css.match(re); assert.ok(m, `block ${re} missing`); return m[1]; };
const vars = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\/\*.*?\*\//g, '').trim()]));
const dark = vars(block(/:root\s*\{([^}]*)\}/));
const light = vars(block(/:root\[data-theme="light"\]\s*\{([^}]*)\}/));

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every themed colour variable is defined for both themes', () => {
  const themed = Object.keys(dark).filter((k) => /^#|^rgba?\(/.test(dark[k]));
  assert.ok(themed.length >= 10);
  for (const k of themed) assert.ok(light[k], `${k} has no light value`);
});

test('no hard-coded colours outside the palette blocks', () => {
  const rest = css.replace(/:root(\[data-theme="light"\])?\s*\{[^}]*\}/g, '');
  const hits = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
  assert.deepStrictEqual(hits, []);
});

test('text colours have at least 4.5:1 contrast on the backgrounds in both themes', () => {
  for (const [name, p] of [['dark', dark], ['light', { ...dark, ...light }]]) {
    for (const bg of ['--bg', '--bg-2', '--bg-3']) {
      for (const fg of ['--fg', '--muted', '--err', '--warn', '--ok', '--accent', '--info']) {
        if (bg === '--bg-3' && ['--err', '--warn', '--ok', '--accent', '--info'].includes(fg) && name === 'dark') continue;
        const c = contrast(p[fg], p[bg]);
        assert.ok(c >= 4.5, `${name}: ${fg} on ${bg} is ${c.toFixed(2)}`);
      }
    }
  }
});

test('Roboto is bundled, linked and first in the font stacks', () => {
  assert.match(dark['--font-ui'], /^Roboto\b/);
  assert.match(dark['--font-mono'], /^"Roboto Mono"/);
  for (const f of ['roboto/latin-400', 'roboto/latin-500', 'roboto/latin-700', 'roboto-mono/latin-400', 'roboto-mono/latin-700']) {
    assert.ok(html.includes(`${f}.css`), `${f} not linked`);
    assert.ok(fs.existsSync(path.join(__dirname, '../node_modules/@fontsource', `${f}.css`)), `${f} not installed`);
  }
  assert.match(html, /font-src 'self' data:/);
});

test('the theme toggle exists and the default setting is system', () => {
  assert.match(html, /id="btn-theme"/);
  assert.strictEqual(require('../src/core/config').DEFAULT_CONFIG.theme, 'system');
});
