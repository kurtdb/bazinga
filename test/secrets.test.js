'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanText, scanSecrets } = require('../src/core/secrets');
const { runChecks } = require('../src/core/checks');
const defaults = require('../src/core/defaults');

const rules = (text) => scanText('f', text).map((f) => f.rule);

test('detects the usual high-confidence secrets', () => {
  assert.deepStrictEqual(rules('-----BEGIN RSA PRIVATE KEY-----'), ['private-key']);
  assert.deepStrictEqual(rules('const k = "AKIAIOSFODNN7ABCDEFG";'), ['aws-access-key']);
  assert.deepStrictEqual(rules(`token: ghp_${'a1B2'.repeat(9)}`), ['github-token']);
  assert.deepStrictEqual(rules('SLACK=xoxb-123456789012-abcdefghij'), ['slack-token']);
  assert.deepStrictEqual(rules(`key = "sk-ant-${'x9'.repeat(15)}"`), ['anthropic-key']);
  assert.deepStrictEqual(rules('url: jdbc:postgresql://db/app?user=app&password=Tr0ub4dor3x'), ['jdbc-password']);
  assert.deepStrictEqual(rules('git clone https://kurt:s3cretpassw0rd@github.com/x/y.git'), ['url-credentials']);
});

test('placeholders, env references and ordinary code are not flagged', () => {
  for (const ok of ['password=${DB_PASSWORD}', 'jdbc:postgresql://db/app?password=${PW}', 'https://user:password@example.com', 'const key = process.env.API_KEY;', 'AKIAEXAMPLEEXAMPLE12 // example key', 'sk-ant-your-key-here-xxxxxxxxxxxxxxxxx', 'let total = a + b;']) {
    assert.deepStrictEqual(rules(ok), [], ok);
  }
});

test('the message never echoes the whole secret, and a marker silences a line', () => {
  const [f] = scanText('f', 'const k = "AKIAIOSFODNN7ABCDEFG";');
  assert.ok(!f.message.includes('AKIAIOSFODNN7ABCDEFG'));
  assert.match(f.message, /AKIA…FG/);
  assert.deepStrictEqual(rules('const k = "AKIAIOSFODNN7ABCDEFG"; // bazinga: allow-secret'), []);
});

test('reports line and column, skips binaries, lock files and big files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-sec-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'ok\nconst k = "AKIAIOSFODNN7ABCDEFG";\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), 'AKIAIOSFODNN7ABCDEFG');
  fs.writeFileSync(path.join(dir, 'x.lock'), 'AKIAIOSFODNN7ABCDEFG');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('AKIAIOSFODNN7ABCDEFG')]));
  const found = scanSecrets({ root: dir, changed: ['a.js', 'x.lock', 'bin.dat', 'missing.js'] });
  assert.strictEqual(found.length, 1);
  assert.deepStrictEqual([found[0].file, found[0].line, found[0].column], ['a.js', 2, 12]);
});

test('the Secrets gate runs inside the quality gate engine and is not hidden as a legacy finding', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-secgate-'));
  require('node:child_process').execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'old.txt'), 'k = "AKIAIOSFODNN7ABCDEFG"\nline2\n');
  require('node:child_process').execFileSync('git', ['add', '-A'], { cwd: dir });
  require('node:child_process').execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'old.txt'), 'k = "AKIAIOSFODNN7ABCDEFG"\nline2 changed\n'); // the secret line itself is untouched
  const res = await runChecks(dir, { tier: 'fast', only: ['Secrets'] });
  const f = res.findings.find((x) => x.rule === 'aws-access-key');
  assert.ok(f, 'finding present');
  assert.strictEqual(f.legacy, false);
  assert.ok(defaults.some((c) => c.name === 'Secrets' && c.native === 'secrets'));
  assert.ok(defaults.some((c) => c.name === 'Secrets (gitleaks)' && c.requiresBin === 'gitleaks'));
});
