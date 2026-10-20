'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixPath } = require('../src/main/shellenv');
const { tmpdir } = require('./helpers');

const posix = process.platform !== 'win32';
const withEnv = (patch, fn) => {
  const saved = {}; for (const k of Object.keys(patch)) saved[k] = process.env[k];
  Object.assign(process.env, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
function fakeShell(body) {
  const dir = tmpdir(); const file = path.join(dir, 'fakesh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test('does nothing when BAZINGA_NO_PATHFIX is set', () => {
  withEnv({ BAZINGA_NO_PATHFIX: '1' }, () => { const before = process.env.PATH; assert.equal(fixPath(), false); assert.equal(process.env.PATH, before); });
});

test('adopts the PATH of the login shell, keeps the old entries, no duplicates', { skip: !posix }, () => {
  const sh = fakeShell('echo "noise"; echo "__BAZINGA_PATH__/opt/brew/bin:/usr/bin:/custom/sdk__BAZINGA_PATH__"');
  withEnv({ BAZINGA_NO_PATHFIX: undefined, SHELL: sh, PATH: '/usr/bin:/old/bin' }, () => {
    assert.equal(fixPath(), true);
    assert.deepEqual(process.env.PATH.split(':'), ['/opt/brew/bin', '/usr/bin', '/custom/sdk', '/old/bin']);
  });
});

test('a shell that prints no marker, an empty PATH or fails leaves PATH alone', { skip: !posix }, () => {
  for (const body of ['echo hello', 'echo "__BAZINGA_PATH____BAZINGA_PATH__"', 'exit 3']) {
    withEnv({ BAZINGA_NO_PATHFIX: undefined, SHELL: fakeShell(body), PATH: '/usr/bin' }, () => { assert.equal(fixPath(), false); assert.equal(process.env.PATH, '/usr/bin'); });
  }
});

test('a missing shell binary does not throw', { skip: !posix }, () => {
  withEnv({ BAZINGA_NO_PATHFIX: undefined, SHELL: '/definitely/not/here', PATH: '/usr/bin' }, () => { assert.equal(fixPath(), false); assert.equal(process.env.PATH, '/usr/bin'); });
});
