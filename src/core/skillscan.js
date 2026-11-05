'use strict';
/**
 * Read-only heuristic scan of a fetched skill's files, run after `git clone` but before any install -
 * the same "high-precision patterns only" spirit as secrets.js, applied to the other risk a fetched
 * SKILL.md carries: it is natural-language instructions a coding agent will read and act on, from a
 * source nobody here wrote. This is pattern-matching, not a security review - it catches the obvious
 * shapes (hidden/invisible characters, download-and-execute, prompt-injection phrasing) and nothing
 * more; a sufficiently obfuscated attempt can still slip past it, same caveat as gitleaks.
 */
const fs = require('node:fs');
const path = require('node:path');

// A deliberately small, hand-picked subset of Unicode "confusables": lower/upper-case Cyrillic and Greek
// letters that render identically (or near-identically) to a Latin letter our RULES look for, the classic
// homoglyph trick for dodging a literal-English regex (a Cyrillic "с" in place of the Latin "c" in "curl").
// Not the full Unicode confusables table - just enough of it to cover the Latin letters RULES actually uses.
const CONFUSABLES = {
  'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'г': 'g', 'һ': 'h', 'і': 'i',
  'ј': 'j', 'о': 'o', 'р': 'p', 'ѕ': 's', 'х': 'x', 'у': 'y',
  'Α': 'A', 'Β': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K',
  'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y',
};
const CONFUSABLE_RE = /[Ͱ-ϿЀ-ӿ]/g;
const ZERO_WIDTH_RE = /[​‌‍﻿⁠᠎]/g;
const BIDI_RE = /[‪-‮⁦-⁩]/g;
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{40,}={0,2}/g;

/**
 * Strips the characters that exist only to evade a literal match (zero-width, bidi override) and maps
 * known Latin-lookalike Cyrillic/Greek letters back to Latin, then NFKC-normalizes (full-width forms,
 * compatibility ligatures, etc). Used for every rule except the ones whose whole job is detecting those
 * same hidden/override characters - those must run against the raw text or they'd erase their own target.
 */
function normalizeForMatching(text) {
  return text
    .replace(ZERO_WIDTH_RE, '')
    .replace(BIDI_RE, '')
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] || ch)
    .normalize('NFKC');
}

function looksLikeText(buf) {
  if (!buf.length) return false;
  let score = 0;
  for (const byte of buf) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) score += 1;
    else if (byte >= 0x80) score += 0.5; // UTF-8 continuation/multibyte - still plausibly text
  }
  return score / buf.length > 0.85;
}

const RULES = [
  // Characters that render as nothing (or as the wrong direction) to a human skimming the file, but are
  // still read by the model - the "hidden instructions" and "Trojan Source" classes of attack. These run
  // on the raw line (see `raw: true`) - normalizing first would strip exactly what they're looking for.
  // Non-global copies of the patterns above: `.exec()` in the matching loop below runs the same rule
  // object against many lines in turn, and a global regex's `.exec()` is stateful (it remembers
  // `lastIndex` between calls) - reusing ZERO_WIDTH_RE/BIDI_RE directly here would silently miss matches
  // on a shorter line after a hit on a longer one. `.replace()`/`matchAll()` reset per call, so the
  // module-level `/g` constants stay safe to share for those.
  { rule: 'hidden-zero-width', severity: 'error', raw: true, re: /[​‌‍﻿⁠᠎]/, label: 'Zero-width or invisible-joiner character' },
  { rule: 'hidden-bidi-override', severity: 'error', raw: true, re: /[‪-‮⁦-⁩]/, label: 'Bidirectional text-override character (can make displayed and actual text order differ)' },
  { rule: 'hidden-control-char', severity: 'warning', raw: true, re: /[\x00-\x08\x0B\x0E-\x1F\x7F-\x9F]/, label: 'Non-printable control character' },

  // Download-and-execute, the classic supply-chain shape.
  { rule: 'pipe-to-shell', severity: 'error', re: /\b(?:curl|wget)\b[^\n]{0,200}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python[23]?)\b/i, label: 'Downloads and pipes straight into a shell/interpreter' },
  { rule: 'base64-exec', severity: 'error', re: /\bbase64\s+(?:-d|--decode)\b[^\n]{0,60}\|\s*(?:sh|bash|zsh|python[23]?)\b/i, label: 'Decodes base64 and pipes it into a shell/interpreter' },
  { rule: 'url-install', severity: 'warning', re: /\b(?:pip3?\s+install|npm\s+install|yarn\s+add|pnpm\s+add)\b[^\n]{0,40}(?:https?:\/\/|git\+)/i, label: 'Installs a package directly from a URL rather than a named registry package' },

  // Commands that would do real damage if an agent ran them as instructed.
  { rule: 'destructive-command', severity: 'error', re: /\brm\s+-rf\s+(?:\/|~|\$HOME)(?=\W|$)/i, label: 'Recursive delete of the home directory or filesystem root' },
  { rule: 'broad-chmod', severity: 'warning', re: /\bchmod\s+(?:-R\s+)?777\b/i, label: 'World-writable permissions (chmod 777)' },

  // Asking the agent to weaken its own guardrails or read credential material.
  { rule: 'disable-safety', severity: 'warning', re: /\b(?:disable|bypass|skip|turn off)\b[^\n]{0,30}\b(?:permission|safety|sandbox|approval|confirmation)s?\b/i, label: 'Asks to disable or bypass a permission/safety/approval mechanism' },
  { rule: 'credential-path-read', severity: 'warning', re: /(?:~|\$HOME)?\/?\.(?:ssh\/id_[a-z]+|aws\/credentials|netrc|npmrc|git-credentials)\b/i, label: 'References a credential file path' },

  // Prompt-injection phrasing and "don't tell the user" style instructions.
  { rule: 'prompt-injection-phrasing', severity: 'warning', re: /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i, label: 'Prompt-injection-style phrasing ("ignore previous instructions")' },
  { rule: 'conceal-from-user', severity: 'warning', re: /\b(?:secretly|covertly|without\s+(?:the\s+)?user'?s?\s+knowledge)\b|\bdo\s+not\s+(?:tell|inform|mention(?:\s+this)?(?:\s+to)?)\s+the\s+user\b/i, label: 'Asks the agent to conceal an action from the user' },
  { rule: 'exfiltration-language', severity: 'warning', re: /\bexfiltrat\w*/i, label: 'Mentions exfiltration' },
];

const SKIP_FILE = /\.(png|jpe?g|gif|ico|webp|pdf|zip|jar|class|lock|woff2?|ttf|svg)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

/** Matches every rule against one line, `raw` rules against `rawLine`, the rest against `normLine`. */
function matchLine(rawLine, normLine) {
  const out = [];
  for (const r of RULES) {
    const m = r.re.exec(r.raw ? rawLine : normLine);
    if (!m) continue;
    out.push({ column: m.index + 1, severity: r.severity, rule: r.rule, message: r.label });
  }
  return out;
}

function scanText(rel, text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.length > 4000) continue;
    const normLine = normalizeForMatching(rawLine);
    for (const f of matchLine(rawLine, normLine)) out.push({ file: rel, line: i + 1, ...f });

    // One level of base64 decode-and-rescan: a blob that isn't piped straight into a shell but is meant
    // to be decoded and read as instructions later (an indirect injection) still scans clean otherwise.
    for (const m of rawLine.matchAll(BASE64_BLOB_RE)) {
      let decoded;
      try { decoded = Buffer.from(m[0], 'base64'); } catch { continue; }
      if (!looksLikeText(decoded)) continue;
      const decodedText = decoded.toString('utf8');
      const decodedNorm = normalizeForMatching(decodedText);
      for (const f of matchLine(decodedText, decodedNorm)) {
        out.push({ file: rel, line: i + 1, column: m.index + 1, severity: f.severity, rule: `${f.rule}-in-base64`, message: `${f.message} (found inside a base64-decoded blob)` });
      }
    }
  }
  return out;
}

/** `dir` is the skill's own folder (inside the checkout), `files` its file list (relative to `dir`), both as `findSkills` returns them. */
function scanSkillFiles(dir, files) {
  const findings = [];
  for (const rel of files) {
    if (SKIP_FILE.test(rel)) continue;
    let buf;
    try {
      const abs = path.join(dir, rel);
      if (fs.statSync(abs).size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    if (buf.subarray(0, 4000).includes(0)) continue; // binary
    findings.push(...scanText(rel, buf.toString('utf8')));
  }
  return findings;
}

module.exports = { scanText, scanSkillFiles, RULES };
