'use strict';
/** One-time move of the settings of the former name ("Lite IDE") into the Bazinga profile folder. Never overwrites. */
const fs = require('node:fs');
const path = require('node:path');

const OLD_NAMES = ['lite-ide', 'Lite IDE'];

/** @returns {string|null} the folder copied from, or null when nothing was done */
function migrateUserData(newDir, appDataDir) {
  try {
    if (fs.existsSync(path.join(newDir, 'settings.json')) || fs.existsSync(path.join(newDir, 'state.json'))) return null;
    for (const name of OLD_NAMES) {
      const old = path.join(appDataDir, name);
      if (path.resolve(old) === path.resolve(newDir) || !fs.existsSync(path.join(old, 'settings.json')) && !fs.existsSync(path.join(old, 'state.json'))) continue;
      fs.mkdirSync(newDir, { recursive: true });
      for (const f of ['settings.json', 'session.json', 'state.json']) {
        if (fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(newDir, f));
      }
      if (fs.existsSync(path.join(old, 'localhistory'))) fs.cpSync(path.join(old, 'localhistory'), path.join(newDir, 'localhistory'), { recursive: true });
      return old;
    }
  } catch { /* a failed migration must never stop the app from starting */ }
  return null;
}

module.exports = { migrateUserData };
