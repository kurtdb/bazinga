'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportGuard, FILES } = require('../scripts/export-guard');

function write(root, rel, text) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }

test('exportGuard: follows require() chains past the seed list (new file discovered, JSON sibling, a dangling require ignored) and copies everything with its directory structure', () => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-eg-from-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-eg-dest-'));
  try {
    // bin/ide-guard.js requires a file already in FILES - must be deduped, not queued twice.
    write(from, 'bin/ide-guard.js', "require('../src/core/ciguard');\n");
    // ciguard.js pulls in a file *not* in FILES (extra.js) and a dangling, nonexistent one.
    write(from, 'src/core/ciguard.js', "require('./extra');\nrequire('./missing');\n");
    // extra.js requires a sibling with no .js extension on disk (the `target` branch, not `${target}.js`).
    write(from, 'src/core/extra.js', "require('./data.json');\n");
    write(from, 'src/core/data.json', '{}');
    write(from, 'src/core/guard.js', "require('./util');\n");
    for (const rel of ['src/core/guardrules.js', 'src/core/oversight.js', 'src/core/scope.js', 'src/core/git.js', 'src/core/util.js']) write(from, rel, '// no deps\n');

    const files = exportGuard(dest, from);
    assert.deepStrictEqual(files, [...FILES, 'src/core/data.json', 'src/core/extra.js'].sort());
    for (const rel of files) {
      assert.strictEqual(fs.readFileSync(path.join(dest, rel), 'utf8'), fs.readFileSync(path.join(from, rel), 'utf8'));
    }
    assert.ok(!fs.existsSync(path.join(dest, 'src/core/missing.js')));
  } finally {
    fs.rmSync(from, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
