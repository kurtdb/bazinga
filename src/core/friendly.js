'use strict';
/**
 * Plain-language errors. The raw message of a low-level failure (spawn ENOENT, EACCES, ECONNREFUSED, "fatal: not a git repository", ...)
 * becomes one sentence a normal person can act on; the raw text stays in brackets so a bug report loses nothing.
 * Messages that Bazinga wrote itself pass through untouched (they are already plain), and so does anything unknown.
 */
const RULES = [
  [/spawn (\S+) ENOENT|(\S+): command not found|'(\S+)' is not recognized as an internal or external command|ENOENT.*\bspawn\b/i, (m) => `The program “${m[1] || m[2] || m[3] || 'it'}” was not found on this computer. Install it, or check that it is on your PATH, then try again. “Setup & health” shows what is missing.`],
  [/\bENOENT\b.*(?:open|stat|scandir|lstat|access)\s+'([^']+)'/i, (m) => `The file or folder “${m[1]}” does not exist (any more).`],
  [/\bEACCES\b|\bEPERM\b|permission denied(?! \(publickey)/i, () => 'This computer did not allow that (permission denied). Check that the file or folder is not locked, read-only or owned by another user.'],
  [/\bENOSPC\b|no space left on device/i, () => 'The disk is full. Free some space and try again.'],
  [/\bEADDRINUSE\b/i, () => 'Another program already uses that network port. Close it, or pick another port.'],
  [/\bECONNREFUSED\b/i, () => 'Nothing is listening at that address. The program or server it needs is probably not running yet.'],
  [/\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timed? ?out/i, () => 'It took too long and was stopped. Check your network or VPN, then try again.'],
  [/\bENOTFOUND\b|getaddrinfo|ECONNRESET|network is unreachable/i, () => 'Could not reach the server. Check your internet connection or VPN.'],
  [/not a git repository/i, () => 'This folder is not a git repository. Bazinga needs git for this (run “git init” in the folder, or open the project’s own folder).'],
  [/index\.lock|another git process seems to be running/i, () => 'Another git command is still running in this project (or crashed and left a lock). Wait a moment; if it stays like this, delete the file .git/index.lock.'],
  [/Authentication failed|could not read Username|Permission denied \(publickey\)|403 Forbidden|401 Unauthorized/i, () => 'The server did not accept your login. Sign in again (for GitHub: “gh auth login”, for Azure DevOps: “az login”) or check your token.'],
  [/CONFLICT|merge conflict/i, () => 'Two changes touch the same lines (a merge conflict). Resolve it by hand, or ask the agent to rebase onto the current branch.'],
  [/EMFILE|too many open files/i, () => 'Too many files are open at once. Close some tabs or terminals and try again.'],
  [/JSON\.parse|Unexpected token .* in JSON|Unexpected end of JSON/i, () => 'A settings or data file is not valid JSON (a comma or bracket is probably missing). Open it and fix the syntax, or delete it to start fresh.'],
];

function clip(s, n = 160) { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; }

/** @returns {string} the friendly sentence with the raw text in brackets, or the original text when nothing matches */
function friendly(raw) {
  const text = String((raw && raw.message) || raw || '');
  if (!text) return 'Something went wrong, but no details were reported.';
  for (const [re, say] of RULES) {
    const m = re.exec(text);
    if (m) return `${say(m)} (${clip(text)})`;
  }
  return text;
}

module.exports = { friendly };
