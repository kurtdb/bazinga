'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, changedFiles } = require('./git');
const { runShell } = require('./util');

const INSTRUCTIONS = `You are reviewing a code change made by an AI coding agent. Be a strict but fair senior reviewer.
Focus on: correctness bugs, unhandled edge cases, security problems, missing or weak tests, behaviour changes that were not asked for, and inconsistency with the surrounding code.
Do not repeat issues the automated gates already reported (listed below). Do not comment on style that a linter would catch.
Answer in plain text. List each issue as "file:line - problem - suggested fix", most severe first. If you find nothing worth raising, say "No issues found." and stop.`;

/** Build the review prompt: instructions + gate findings + the diff (and new files), capped to maxChars. */
const RULES_CAP = 8000;
/** Review rules: the IDE-level `reviewRules` setting, then the project's REVIEW.md (project last, so it can refine or override). */
function loadReviewRules(root, ideRules) {
  const out = [];
  const cap = (t) => (t.length > RULES_CAP ? `${t.slice(0, RULES_CAP)}\n[rules truncated]` : t);
  if (typeof ideRules === 'string' && ideRules.trim()) out.push({ source: 'IDE settings', text: cap(ideRules.trim()) });
  for (const name of ['REVIEW.md', 'review.md', '.github/REVIEW.md']) {
    try {
      const abs = path.join(root, name);
      if (!fs.statSync(abs).isFile()) continue;
      const t = fs.readFileSync(abs, 'utf8').trim();
      if (t) { out.push({ source: name, text: cap(t) }); break; }
    } catch { /* absent */ }
  }
  return out;
}

async function buildReviewPrompt(root, { findings = [], maxChars = 80000, reviewRules } = {}) {
  let diff = '';
  try { diff = await git(root, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '--relative', 'HEAD']); } catch { /* no HEAD yet */ }

  const parts = [INSTRUCTIONS];
  const rules = loadReviewRules(root, reviewRules);
  if (rules.length) {
    parts.push('## Review rules for this codebase (check the diff against these; the later source wins on conflicts)');
    for (const r of rules) parts.push(`### From ${r.source}\n${r.text}`);
  }
  const real = findings.filter((f) => !f.legacy);
  if (real.length) {
    parts.push('## Findings already reported by the automated gates');
    parts.push(real.slice(0, 80).map((f) => `${f.file || '(project)'}${f.line ? `:${f.line}` : ''} [${f.tool}${f.rule ? ` ${f.rule}` : ''}] ${f.message}`).join('\n'));
  }
  let budget = maxChars - parts.join('\n\n').length - 200;
  parts.push('## Diff against HEAD');
  if (diff.length > budget) { parts.push(`${diff.slice(0, Math.max(budget, 0))}\n[diff truncated]`); budget = 0; } else { parts.push(diff || '(no tracked changes)'); budget -= diff.length; }

  const untracked = (await changedFiles(root)).filter((f) => f.status === '?');
  for (const f of untracked) {
    if (budget < 500) { parts.push('[further new files omitted]'); break; }
    try {
      const abs = path.join(root, f.path);
      if (fs.statSync(abs).size > 200000) continue;
      const buf = fs.readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) continue;
      const text = buf.toString('utf8').split('\n').slice(0, 300).join('\n').slice(0, budget - 100);
      parts.push(`## New file: ${f.path}\n${text}`);
      budget -= text.length + f.path.length + 20;
    } catch { /* unreadable */ }
  }
  return parts.join('\n\n');
}

/** Pipe the prompt to the review command (stdin) and return its output. */
async function runReview(root, { command, findings, reviewRules, signal, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!command) return { error: 'No review command configured (Settings > Review command).' };
  const prompt = await buildReviewPrompt(root, { findings, reviewRules });
  const res = await runShell(command, { cwd: root, input: prompt, timeoutMs, signal });
  if (res.cancelled) return { cancelled: true };
  if (res.timedOut) return { error: 'The review command timed out.' };
  const output = res.stdout.trim();
  if (res.code !== 0 && !output) return { error: `Review command failed (exit ${res.code}):\n${(res.stderr || '').trim().split('\n').slice(-8).join('\n')}` };
  return { output: output || '(the review command produced no output)', promptChars: prompt.length };
}

module.exports = { loadReviewRules, buildReviewPrompt, runReview };
