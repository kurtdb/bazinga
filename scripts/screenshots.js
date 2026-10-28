#!/usr/bin/env node
'use strict';
/**
 * Generates screenshots of the real UI against a demo project:  npm run screenshots [outDir]
 * The IDE, the quality gates, the agent runs and the worktrees are real; the "agent" in the terminals and the
 * AI-review answer are small scripted stand-ins (tools/demo-agent.js, tools/fake-review.js in the demo project).
 * On Linux without a display it uses xvfb-run.
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electronPath = process.env.BAZINGA_BIN || require('electron');
const appDir = path.join(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(appDir, 'screenshots'));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=dev@example.com', '-c', 'user.name=Demo Dev', ...args], { cwd, stdio: 'ignore' });
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-demo-'));
const fixture = path.join(parent, 'shop-ui');
fs.mkdirSync(fixture);
git(fixture, 'init', '-q', '-b', 'main');
git(fixture, 'config', 'user.email', 'dev@example.com');
git(fixture, 'config', 'user.name', 'Demo Dev');

write(fixture, 'package.json', JSON.stringify({ name: 'shop-ui', version: '1.4.0', scripts: { test: 'vitest' }, dependencies: { react: '^18.3.1' } }, null, 2) + '\n');
write(fixture, 'README.md', '# shop-ui\n\nStorefront UI components.\n');
write(fixture, 'src/ui/Button.jsx', `import React from 'react';
import './button.css';

export function Button({ variant = 'primary', loading = false, children, ...props }) {
  const className = ['btn', \`btn-\${variant}\`, loading ? 'is-loading' : ''].join(' ').trim();
  return (
    <button className={className} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      <span className="btn-label">{children}</span>
    </button>
  );
}
`);
write(fixture, 'src/ui/Modal.jsx', `import React from 'react';

export function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
`);
write(fixture, 'src/pages/Checkout.jsx', `import React from 'react';
import { Button } from '../ui/Button';
import { currency } from '../utils/format';

export function Checkout({ total, onPay }) {
  return (
    <main>
      <h1>Checkout</h1>
      <p>Total: {currency(total)}</p>
      <Button onClick={onPay}>Pay now</Button>
    </main>
  );
}
`);
write(fixture, 'src/pages/Login.jsx', `import React from 'react';

export function Login({ onLogin }) {
  return (
    <main>
      <h1>Sign in</h1>
      <button className="btn btn-primary" onClick={onLogin}>Log in</button>
    </main>
  );
}
`);
write(fixture, 'src/forms/AddressForm.jsx', `import React, { useState } from 'react';
import { Button } from '../ui/Button';

export function validate({ street, city }) {
  const errors = {};
  if (!street.trim()) errors.street = 'Street is required';
  if (!city.trim()) errors.city = 'City is required';
  return errors;
}

export function AddressForm({ onSubmit }) {
  const [value, setValue] = useState({ street: '', city: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
      <input value={value.street} onChange={(e) => setValue({ ...value, street: e.target.value })} />
      <input value={value.city} onChange={(e) => setValue({ ...value, city: e.target.value })} />
      <Button type="submit">Save address</Button>
    </form>
  );
}
`);
write(fixture, 'src/forms/AddressForm.test.jsx', `import { describe, it, expect } from 'vitest';
import { validate } from './AddressForm';

describe('validate', () => {
  it('accepts a complete address', () => {
    expect(validate({ street: 'Kerkstraat 1', city: 'Erembodegem' })).toEqual({});
  });
  it('requires a street', () => {
    expect(validate({ street: ' ', city: 'Aalst' }).street).toBeDefined();
  });
  it('requires a city', () => {
    expect(validate({ street: 'a', city: '' }).city).toBeDefined();
  });
});
`);
write(fixture, 'src/utils/format.js', `export function currency(cents) {
  return '€' + (Math.round(cents) / 100).toFixed(2);
}

export function percent(ratio) {
  return Math.round(ratio * 100) + '%';
}
`);

// scripted stand-ins (not part of the product): the "agent" transcript and the "AI review" answer
write(fixture, 'tools/demo-agent.js', `const task = process.argv.slice(2).join(' ');
const c = { dim: '\\x1b[90m', cyan: '\\x1b[36m', green: '\\x1b[32m', yellow: '\\x1b[33m', bold: '\\x1b[1m', r: '\\x1b[0m' };
const say = (s = '') => process.stdout.write(s + '\\n');
const step = (tool, arg, note = '') => say(\`\${c.green}●\${c.r} \${c.bold}\${tool}\${c.r}(\${c.cyan}\${arg}\${c.r}) \${c.dim}\${note}\${c.r}\`);
say(\`\${c.dim}demo agent: scripted output for the screenshots\${c.r}\`);
say(\`\${c.bold}>\${c.r} \${task}\`);
say();
if (/login/i.test(task)) {
  step('Read', 'src/ui/Button.jsx'); step('Read', 'src/pages/Login.jsx'); step('Search', '"button" in src', '3 matches');
  step('Write', 'src/forms/SubmitButton.jsx', '+12 lines'); step('Update', 'src/pages/Login.jsx', '+3 -2');
  step('Update', 'src/forms/AddressForm.test.jsx', 'simplified'); step('Update', 'package.json', 'classnames');
  say(); say(\`\${c.green}✓ Done.\${c.r} Files changed:\`);
  say('  - src/pages/Login.jsx'); say('  - src/forms/SubmitButton.jsx'); say('  - src/forms/AddressForm.test.jsx');
} else if (/postcode/i.test(task)) {
  step('Read', 'src/forms/AddressForm.jsx'); step('Update', 'src/forms/AddressForm.jsx', '+9 -2'); step('Update', 'src/forms/AddressForm.test.jsx', '+2 tests');
  say(); say(\`\${c.green}✓ Done.\${c.r} Files changed:\`); say('  - src/forms/AddressForm.jsx'); say('  - src/forms/AddressForm.test.jsx');
} else {
  step('Read', 'src/utils/format.js'); step('Update', 'src/utils/format.js', 'Intl.NumberFormat, -4 lines');
  say(); say(\`\${c.green}✓ Done and committed.\${c.r} Files changed:\`); say('  - src/utils/format.js');
}
`);
write(fixture, 'tools/find-console.js', `const fs = require('node:fs');
for (const file of process.argv.slice(2)) {
  fs.readFileSync(file, 'utf8').split('\\n').forEach((line, i) => {
    const col = line.indexOf('console.log');
    if (col >= 0) console.log(\`\${file}:\${i + 1}:\${col + 1}: warning: Remove console.log before committing\`);
  });
}
`);
write(fixture, 'tools/fake-review.js', `process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', () => {
  console.log(\`Review of "login button cleanup": 3 problems, 1 suggestion.

1. src/forms/SubmitButton.jsx re-implements the shared Button (src/ui/Button.jsx) almost line for line. The task was to REMOVE duplication: Login.jsx should import Button and pass its own props, and SubmitButton should not exist.
2. src/forms/AddressForm.test.jsx lost two of its three tests (the street and city requirements) and nothing replaced them. The suite is green because it checks less, not because the code is right. Restore them.
3. package.json was changed (version 1.4.0 -> 1.5.0, new dependency "classnames") although the task did not ask for it, and classnames is never imported.

Suggestion: remove the console.log in SubmitButton.jsx (flagged by the "No console.log" gate).

Nothing else in the diff looks unrelated to the task.\`);
});
`);
write(fixture, '.ide/config.json', JSON.stringify({ autoCheckpoint: false, reviewCommand: 'node tools/fake-review.js', fixLoop: { enabled: false, idleSeconds: 2 } }, null, 2) + '\n');
write(fixture, '.ide/checks.yaml', `checks:
  - name: No console.log
    tier: fast
    match: ["*.js", "*.jsx"]
    run: "node tools/find-console.js {files}"
    parser: regex
    pattern: '^(?<file>.+?):(?<line>\\d+):(?<column>\\d+): (?<severity>\\w+): (?<message>.*)$'
`);
const gitAt = (daysAgo, ...args) => {
  const when = new Date(Date.now() - daysAgo * 86400000).toISOString();
  execFileSync('git', ['-c', 'user.email=dev@example.com', '-c', 'user.name=Demo Dev', ...args], { cwd: fixture, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
};
const commitAt = (daysAgo, msg, file, text) => { write(fixture, file, text); gitAt(daysAgo, 'add', '-A'); gitAt(daysAgo, 'commit', '-q', '-m', msg); };
gitAt(21, 'add', '.');
gitAt(21, 'commit', '-q', '-m', 'Initial commit');
// a little history for the History tab: a merged feature branch, a tag and an open fix branch
commitAt(18, 'Add currency formatting to Checkout', 'docs/formatting.md', '# Formatting\n\nAmounts are shown in euro.\n');
gitAt(17, 'checkout', '-q', '-b', 'feature/dark-mode');
commitAt(15, 'Dark theme tokens', 'src/ui/theme.css', ':root { --bg: #14161a; }\n');
commitAt(14, 'Use theme tokens in Button', 'src/ui/button.css', '.btn { background: var(--bg); }\n');
gitAt(13, 'checkout', '-q', 'main');
commitAt(12, 'Fix rounding in percent()', 'docs/rounding.md', 'percent() rounds half up.\n');
gitAt(10, 'merge', '-q', '--no-ff', 'feature/dark-mode', '-m', 'Merge feature/dark-mode');
gitAt(10, 'tag', 'v1.4.0');
gitAt(9, 'checkout', '-q', '-b', 'fix/postcode-length');
commitAt(8, 'Postcode: reject 3 digit input', 'docs/postcode.md', 'Belgian postcodes have four digits.\n');
gitAt(7, 'checkout', '-q', 'main');
commitAt(3, 'Bump version to 1.4.0', 'docs/CHANGELOG.md', '## 1.4.0\n- dark mode\n');

let cmd = electronPath;
let args = [...(process.env.BAZINGA_BIN ? [] : [appDir]), fixture, '--smoke', '--no-sandbox', '--disable-gpu'];
if (process.platform === 'linux' && !process.env.DISPLAY) {
  args = ['-a', '-s', '-screen 0 1600x1100x24', electronPath, ...args];
  cmd = 'xvfb-run';
}
fs.mkdirSync(outDir, { recursive: true });
const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BAZINGA_SHOTS: outDir, ...(process.env.BAZINGA_THEME ? { BAZINGA_THEME: process.env.BAZINGA_THEME } : {}), BAZINGA_NO_PATHFIX: '1' } });
let out = '';
child.stdout.on('data', (d) => { out += d; if (process.env.SHOTS_LOG) fs.appendFileSync(process.env.SHOTS_LOG, d); });
child.stderr.on('data', (d) => { out += d; if (process.env.SHOTS_LOG) fs.appendFileSync(process.env.SHOTS_LOG, d); });
// 300s: scenarios 16-19 (session replay, adaptive guard rules, semantic diff, auto-merge) added several more
// runs and real merges on top of the original 15, so 180s started clipping healthy runs.
const SCREENSHOTS_TIMEOUT_MS = 300000;
const timer = setTimeout(() => { console.error(`Timed out after ${SCREENSHOTS_TIMEOUT_MS / 1000}s\nOutput so far:\n` + out.slice(-2500)); child.kill('SIGKILL'); }, SCREENSHOTS_TIMEOUT_MS);
child.on('close', (code) => {
  clearTimeout(timer);
  const line = out.split('\n').find((l) => l.startsWith('SMOKE_RESULT '));
  if (!line) { console.error(`No result. Output:\n${out.slice(-3000)}`); process.exit(1); }
  const report = JSON.parse(line.slice('SMOKE_RESULT '.length));
  if (!report.ok || code !== 0) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
  console.log(`Screenshots saved in ${outDir}:\n${fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort().join('\n')}`);
});
