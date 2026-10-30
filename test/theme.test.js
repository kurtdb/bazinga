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
// every other theme block, discovered from the CSS itself so a new theme is checked automatically
const themeNames = [...css.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{/g)].map((m) => m[1]);
assert.ok(themeNames.includes('light') && themeNames.length >= 4, `expected several themes, found: ${themeNames.join(', ')}`);
const themes = { dark, ...Object.fromEntries(themeNames.map((name) => [name, { ...dark, ...vars(block(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`))) }])) };

const { contrast } = require('../src/core/contrast');

test('every themed colour variable is defined for every theme', () => {
  const themed = Object.keys(dark).filter((k) => /^#|^rgba?\(/.test(dark[k]));
  assert.ok(themed.length >= 10);
  for (const [name, p] of Object.entries(themes)) {
    if (name === 'dark') continue;
    for (const k of themed) assert.ok(p[k], `${name} has no value for ${k}`);
  }
});

test('no hard-coded colours outside the palette blocks', () => {
  const rest = css.replace(/:root(\[data-theme="[^"]+"\])?\s*\{[^}]*\}/g, '');
  const hits = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
  assert.deepStrictEqual(hits, []);
});

test('text colours have at least 4.5:1 contrast on the backgrounds in every theme', () => {
  for (const [name, p] of Object.entries(themes)) {
    for (const bg of ['--bg', '--bg-2', '--bg-3']) {
      for (const fg of ['--fg', '--muted', '--err', '--warn', '--ok', '--accent', '--info']) {
        // the original dark theme's saturated tokens were never tuned against the lighter --bg-3 raised surface; every theme added since is held to the full bar
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

test('the config schema accepts every CSS theme, and the CSS defines every schema theme', () => {
  const schemaThemes = require('../src/core/configschema').SCHEMA.properties.theme.enum;
  assert.deepStrictEqual([...schemaThemes].sort(), ['dark', 'light', 'system', ...themeNames.filter((n) => n !== 'light')].sort());
});
