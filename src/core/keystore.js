'use strict';
/**
 * Tokens (Jira, ...) kept encrypted with the operating system's key store (Electron safeStorage: Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux). Nothing is ever written in clear text: when no key store is available, saving is refused.
 * The crypto functions are injected so this module can be tested without Electron. (Not to be confused with secrets.js, the secret scanner.)
 */
const fs = require('node:fs');
const path = require('node:path');

class SecretStore {
  /** @param {string} file  @param {{ available: () => boolean, encrypt: (s: string) => Buffer, decrypt: (b: Buffer) => string }} crypto */
  constructor(file, crypto) { this.file = file; this.crypto = crypto; }

  _read() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
  _write(o) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(o), { mode: 0o600 }); }

  available() { try { return !!this.crypto.available(); } catch { return false; } }

  set(name, value) {
    if (!this.available()) throw new Error('This computer has no secure key store available (Keychain, Windows credential store or libsecret), so the token is not saved.');
    const all = this._read();
    all[String(name)] = this.crypto.encrypt(String(value)).toString('base64');
    this._write(all);
  }

  get(name) {
    const v = this._read()[String(name)];
    if (!v || !this.available()) return null;
    try { return this.crypto.decrypt(Buffer.from(v, 'base64')); } catch { return null; }
  }

  has(name) { return this.get(name) !== null; }

  delete(name) { const all = this._read(); if (name in all) { delete all[name]; this._write(all); } }
}

module.exports = { SecretStore };
