'use strict';
/**
 * Pull request status of an agent run's branch (GitHub via `gh`, Azure DevOps via `az`) and work items mentioned in
 * the branch / task / commit messages. The parsers are pure and take the CLI's JSON; only fetchStatus runs a CLI.
 */
const { git } = require('./git');
const { findRun } = require('./runs');
const pr = require('./pr');

const trim = (s) => String(s).trim();

function statusCommand(remote, branch) {
  if (remote.host === 'github') return { bin: 'gh', args: ['pr', 'view', branch, '--json', 'number,title,state,isDraft,url,reviewDecision,mergeable,statusCheckRollup'] };
  if (remote.host === 'azure') return { bin: 'az', args: ['repos', 'pr', 'list', '--organization', remote.orgUrl, '--project', remote.project, '--repository', remote.repo, '--source-branch', branch, '--status', 'all', '--top', '1', '--output', 'json'] };
  return null;
}

function checkCounts(rollup) {
  const c = { passed: 0, failed: 0, pending: 0 };
  for (const x of Array.isArray(rollup) ? rollup : []) {
    const concl = String(x.conclusion || x.state || '').toUpperCase();
    const status = String(x.status || '').toUpperCase();
    if (status && status !== 'COMPLETED') c.pending++;
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(concl)) c.passed++;
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(concl)) c.failed++;
    else c.pending++; // PENDING / EXPECTED / empty
  }
  return c;
}

/** @returns normalized {found, number, title, state, url, checks, review, mergeable} or {found:false} */
function parseStatus(host, stdout) {
  let j;
  try { j = JSON.parse(String(stdout || '').trim() || 'null'); } catch { throw new Error('Could not read the pull request status (unexpected output).'); }
  if (host === 'github') {
    if (!j || typeof j !== 'object') return { found: false };
    const st = String(j.state || '').toUpperCase();
    return {
      found: true, number: j.number, title: j.title || '', url: j.url || null,
      state: st === 'MERGED' ? 'merged' : st === 'CLOSED' ? 'closed' : j.isDraft ? 'draft' : 'open',
      checks: checkCounts(j.statusCheckRollup),
      review: { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' }[String(j.reviewDecision || '').toUpperCase()] || 'none',
      mergeable: { MERGEABLE: 'yes', CONFLICTING: 'conflicts' }[String(j.mergeable || '').toUpperCase()] || 'unknown',
    };
  }
  if (host === 'azure') {
    const p = Array.isArray(j) ? j[0] : j;
    if (!p || !p.pullRequestId) return { found: false };
    const votes = (p.reviewers || []).map((r) => Number(r.vote) || 0);
    const status = String(p.status || '').toLowerCase();
    const web = p.repository && p.repository.webUrl;
    return {
      found: true, number: p.pullRequestId, title: p.title || '', url: web ? `${web}/pullrequest/${p.pullRequestId}` : null,
      state: status === 'completed' ? 'merged' : status === 'abandoned' ? 'closed' : p.isDraft ? 'draft' : 'open',
      checks: null, // policy evaluations need a second call; not shown rather than guessed
      review: votes.some((v) => v <= -5) ? 'changes' : votes.some((v) => v >= 5) ? 'approved' : votes.length ? 'required' : 'none',
      mergeable: { succeeded: 'yes', conflicts: 'conflicts' }[String(p.mergeStatus || '').toLowerCase()] || 'unknown',
    };
  }
  return { found: false };
}

/** One-line text for the UI. */
function describe(s) {
  if (!s || !s.found) return 'No pull request yet';
  const parts = [`PR #${s.number} ${s.state}`];
  if (s.checks && (s.checks.passed + s.checks.failed + s.checks.pending)) {
    const total = s.checks.passed + s.checks.failed + s.checks.pending;
    parts.push(s.checks.failed ? `${s.checks.failed} of ${total} checks failed` : s.checks.pending ? `${s.checks.passed}/${total} checks passed, ${s.checks.pending} running` : `all ${total} checks passed`);
  }
  if (s.review !== 'none') parts.push({ approved: 'approved', changes: 'changes requested', required: 'review needed' }[s.review]);
  if (s.mergeable === 'conflicts') parts.push('merge conflicts');
  return parts.join(' · ');
}

/**
 * Work item references in free text.
 *   GitHub repos: #123 -> issue; Azure repos: AB#123 and #123 -> Azure Boards; Jira keys (ABC-123) only get a link when jiraBaseUrl is set.
 */
function extractWorkItems(texts, remote = {}, { jiraBaseUrl } = {}) {
  const seen = new Map();
  const add = (key, url, kind) => { if (!seen.has(key)) seen.set(key, { key, url, kind }); };
  for (const t of texts.filter(Boolean).map(String)) {
    for (const m of t.matchAll(/(?<![\w/&])(AB)?#(\d{1,7})\b/g)) {
      const n = m[2];
      if (remote.host === 'github' && !m[1]) add(`#${n}`, `https://github.com/${remote.owner}/${remote.repo}/issues/${n}`, 'issue');
      else if (remote.host === 'azure') add(`#${n}`, `${remote.orgUrl}/${encodeURIComponent(remote.project)}/_workitems/edit/${n}`, 'work item');
      else if (m[1]) add(`AB#${n}`, null, 'work item');
    }
    for (const m of t.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g)) {
      if (/^(UTF|ISO|SHA|CVE)-/.test(m[1])) continue;
      add(m[1], jiraBaseUrl && /^https:\/\//.test(jiraBaseUrl) ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${m[1]}` : null, 'ticket');
    }
  }
  return [...seen.values()];
}

async function fetchStatus(root, id, { jiraBaseUrl, env, exec = pr.run } = {}) {
  const { run: r, main } = await findRun(root, id);
  const remote = await pr.remoteInfo(main.top);
  let subjects = [];
  try { subjects = trim(await git(r.top, ['log', '--format=%s', `${r.baseCommit}..HEAD`])).split(/\r?\n/).filter(Boolean); } catch { /* none */ }
  const workItems = extractWorkItems([r.branch, r.name, r.task, ...subjects], remote, { jiraBaseUrl });
  const cmd = statusCommand(remote, r.branch);
  if (!cmd) return { remote: remote.host, workItems, pr: { found: false }, text: remote.name ? `No integration for ${remote.host}` : 'No origin remote', unsupported: true };
  try {
    const { stdout } = await exec(cmd.bin, cmd.args, { cwd: r.top, env });
    const s = parseStatus(remote.host, stdout);
    return { remote: remote.host, workItems, pr: s, text: describe(s) };
  } catch (err) {
    if (err.code === 'ENOENT') return { remote: remote.host, workItems, pr: { found: false }, text: `"${cmd.bin}" is not installed`, error: 'cli-missing' };
    const msg = trim(err.stderr || err.stdout || err.message);
    if (/no pull requests? found|could not find any pull requests/i.test(msg)) return { remote: remote.host, workItems, pr: { found: false }, text: describe({ found: false }) };
    return { remote: remote.host, workItems, pr: { found: false }, text: msg.split('\n').slice(-2).join(' ').slice(0, 200), error: 'failed' };
  }
}

module.exports = { statusCommand, parseStatus, describe, extractWorkItems, fetchStatus, checkCounts };
