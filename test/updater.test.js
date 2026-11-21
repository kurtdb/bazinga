'use strict';
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/core/updater');

test('feed: github owner/repo or an https folder; plain http only for localhost; nothing set is explained', () => {
  assert.deepStrictEqual(U.feedFor({ updates: { github: 'kurt/bazinga' } }), { feed: { provider: 'github', owner: 'kurt', repo: 'bazinga' } });
  assert.deepStrictEqual(U.feedFor({ updates: { url: 'https://example.com/updates/' } }), { feed: { provider: 'generic', url: 'https://example.com/updates/' } });
  assert.ok(U.feedFor({ updates: { url: 'http://localhost:8080/u/' } }).feed);
  assert.match(U.feedFor({ updates: { url: 'http://example.com/u/' } }).error, /https/);
  assert.match(U.feedFor({ updates: { github: 'not a repo' } }).error, /owner\/repo/);
  assert.match(U.feedFor({ updates: { url: 'nonsense' } }).error, /not a web address/);
  assert.match(U.feedFor({}).error, /No update source/);
  assert.match(U.feedFor(null).error, /No update source/);
});

test('install blockers: source runs, portable Windows, unsigned macOS, Linux without AppImage; the installed Windows app and the AppImage are fine', () => {
  assert.match(U.installBlocker({ platform: 'win32', packaged: false }), /installed app/);
  assert.match(U.installBlocker({ platform: 'win32', packaged: true, portable: true }), /portable/);
  assert.match(U.installBlocker({ platform: 'darwin', packaged: true, signed: false }), /signed/);
  assert.match(U.installBlocker({ platform: 'linux', packaged: true }), /AppImage/);
  assert.match(U.installBlocker({ platform: 'linux', packaged: true, isAppImage: false }), /AppImage/);
  assert.strictEqual(U.installBlocker({ platform: 'win32', packaged: true, portable: false }), '');
  assert.strictEqual(U.installBlocker({ platform: 'linux', packaged: true, isAppImage: true }), '');
  assert.strictEqual(U.installBlocker({ platform: 'darwin', packaged: true }), '', 'unknown signing state: try, the updater reports the failure');
});

test('messages for the window', () => {
  assert.match(U.describe('available', { version: '1.2.3' }), /1\.2\.3 is available/);
  assert.match(U.describe('progress', { percent: 41.6, version: '1.2.3' }), /42 %/);
  assert.match(U.describe('downloaded', { version: '1.2.3' }), /Restart/);
  assert.match(U.describe('error', { message: 'net::ERR\nstack' }), /^Update check failed: net::ERR$/);
  assert.strictEqual(U.describe('bogus'), '');
});
