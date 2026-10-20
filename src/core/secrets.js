'use strict';
/**
 * Native secret scan of the changed files: high-precision patterns only (a noisy gate gets switched off).
 * For the full rule set install gitleaks; the "Secrets (gitleaks)" gate then runs it as well.
 * Matched values are never printed back in full.
 */
const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  { rule: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/, label: 'Private key' },
  { rule: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { rule: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/, label: 'GitHub token' },
  { rule: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token' },
  { rule: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, label: 'Anthropic API key' },
  { rule: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/, label: 'API key (sk-…)' },
  { rule: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'Google API key' },
  { rule: 'stripe-live-key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/, label: 'Stripe live key' },
  { rule: 'azure-storage-key', re: /AccountKey=[A-Za-z0-9+/]{60,}={0,2}/, label: 'Azure storage account key' },
  { rule: 'jdbc-password', re: /jdbc:[a-z0-9:]+:\/\/[^\s"']*[?&;]password=(?!\$\{|<|\{\{|changeme|password|secret|xxx)[^\s&;"']{4,}/i, label: 'Password in a JDBC url' },
  { rule: 'url-credentials', re: /\b[a-z][a-z0-9+.-]{1,10}:\/\/[^\s/:@"']{2,}:(?!\$\{|<|\{\{|%\{|password|secret|changeme|xxx|\*+)[^\s/:@"']{6,}@[a-z0-9.-]+/i, label: 'Credentials in a URL' },
];
const SKIP_FILE = /(\.(png|jpe?g|gif|ico|pdf|zip|jar|class|lock|min\.js|map|svg|woff2?|ttf)$|(^|\/)(node_modules|dist|build|target|\.git)\/)/i;
const PLACEHOLDER = /(example|your[_-]?(key|token)|dummy|placeholder|fake|sample|xxxx|redacted)/i;
const MAX_BYTES = 1024 * 1024;

const redact = (s) => (s.length <= 10 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)}`);

function scanText(rel, text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      if (PLACEHOLDER.test(line) && r.rule !== 'private-key') continue;
      if (/bazinga:\s*allow-secret/.test(line)) continue;
      out.push({ file: rel, line: i + 1, column: m.index + 1, severity: 'error', rule: r.rule, message: `Possible secret: ${r.label} (${redact(m[0])}). Remove it from the code and load it from the environment or a secret store; rotate it if it was ever committed. Mark a false positive with “bazinga: allow-secret”.` });
      break;
    }
  }
  return out;
}

function scanSecrets({ root, changed }) {
  const findings = [];
  for (const rel of changed) {
    if (SKIP_FILE.test(rel)) continue;
    let buf;
    try { const abs = path.join(root, rel); if (fs.statSync(abs).size > MAX_BYTES) continue; buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.subarray(0, 4000).includes(0)) continue;
    findings.push(...scanText(rel, buf.toString('utf8')));
  }
  return findings;
}

module.exports = { scanText, scanSecrets, RULES };
