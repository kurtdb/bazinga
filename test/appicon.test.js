'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('app icon: every icon the builds point at exists, and the PNG is a real 1024px image', () => {
  for (const f of [pkg.build.win.icon, pkg.build.mac.icon, pkg.build.linux.icon, 'build/icon.png']) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
  }
  const png = fs.readFileSync(path.join(root, 'build', 'icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(fs.readFileSync(path.join(root, pkg.build.win.icon)).readUInt16LE(2), 1, 'a Windows .ico');
  assert.equal(fs.readFileSync(path.join(root, pkg.build.mac.icon)).subarray(0, 4).toString(), 'icns');
  assert.ok(pkg.build.files.includes('build/icon.png'), 'the window icon ships inside the app');
});
