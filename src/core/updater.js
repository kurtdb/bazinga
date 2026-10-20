'use strict';
/**
 * Updates through electron-updater, opt-in. Where updates come from is a setting (the repository is not known to the app):
 *   "updates": { "check": true, "github": "owner/repo" }          releases of a GitHub repository (needs latest.yml / latest-mac.yml in the release)
 *   "updates": { "check": true, "url": "https://host/path/" }     any web folder that holds latest.yml and the installers
 * Pure helpers here; main.js drives electron-updater with them.
 */
const GITHUB = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** @returns {{ feed: object }|{ error: string }} the feed options for autoUpdater.setFeedURL */
function feedFor(cfg) {
  const u = (cfg && cfg.updates) || {};
  if (u.github) {
    if (!GITHUB.test(String(u.github))) return { error: '“updates.github” must look like owner/repo.' };
    const [owner, repo] = String(u.github).split('/');
    return { feed: { provider: 'github', owner, repo } };
  }
  if (u.url) {
    let url;
    try { url = new URL(String(u.url)); } catch { return { error: '“updates.url” is not a web address.' }; }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return { error: '“updates.url” must be https (updates are programs: they must not travel over plain http).' };
    return { feed: { provider: 'generic', url: url.href } };
  }
  return { error: 'No update source is set. Add "updates": { "github": "owner/repo" } (or "url") to the IDE settings.' };
}

/** Why an automatic install cannot work here, or '' when it can. */
function installBlocker({ platform, packaged, portable, signed }) {
  if (!packaged) return 'Updates only work in the installed app, not when started from the source.';
  if (platform === 'win32' && portable) return 'The portable build cannot update itself; use the installer version, or download the new portable file.';
  if (platform === 'darwin' && signed === false) return 'macOS only installs updates for a signed app. This build is ad-hoc signed: download the new version from the releases page instead.';
  if (platform === 'linux') return 'Automatic updates are not set up for Linux builds.';
  return '';
}

/** What the window shows for the updater's events. */
function describe(ev, info = {}) {
  switch (ev) {
    case 'checking': return 'Checking for updates…';
    case 'none': return 'You have the latest version.';
    case 'available': return `Version ${info.version} is available.`;
    case 'progress': return `Downloading ${info.version || 'the update'}: ${Math.round(info.percent || 0)} %`;
    case 'downloaded': return `Version ${info.version} is downloaded. Restart to install it.`;
    case 'error': return `Update check failed: ${String(info.message || 'unknown error').split('\n')[0].slice(0, 200)}`;
    default: return '';
  }
}

module.exports = { feedFor, installBlocker, describe };
