'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { choosePublish } = require('../scripts/dist');

const cfg = [{ provider: 'github' }];

test('publish: kept when a GitHub repository is known (git remote, CI, or written in the config), dropped otherwise', () => {
  assert.equal(choosePublish({ remoteUrl: 'https://github.com/kurt/bazinga.git\n', env: {}, configured: cfg }).publish, cfg);
  assert.equal(choosePublish({ remoteUrl: 'git@github.com:kurt/bazinga.git', env: {}, configured: cfg }).publish, cfg);
  assert.equal(choosePublish({ remoteUrl: '', env: { GITHUB_REPOSITORY: 'kurt/bazinga' }, configured: cfg }).publish, cfg);
  const explicit = [{ provider: 'github', owner: 'kurt', repo: 'bazinga' }];
  assert.equal(choosePublish({ remoteUrl: '', env: {}, configured: explicit }).publish, explicit);
  const none = choosePublish({ remoteUrl: '', env: {}, configured: cfg });
  assert.equal(none.publish, null); assert.match(none.why, /no update feed/);
  assert.equal(choosePublish({ remoteUrl: 'https://dev.azure.com/org/p/_git/r', env: {}, configured: cfg }).publish, null, 'an Azure remote is not a GitHub repository');
});

test('the npm build scripts go through the wrapper (a zip without .git crashed the macOS build at the very end)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['dist:mac'], /scripts\/dist\.js/); assert.match(pkg.scripts['dist:win'], /scripts\/dist\.js/);
});
