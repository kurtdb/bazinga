'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ps = require('../src/core/prstatus');
const { parseRemote } = require('../src/core/pr');
const runs = require('../src/core/runs');
const { repo, sh } = require('./helpers');

const gh = (o) => JSON.stringify({ number: 7, title: 'Add x', state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/7', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', statusCheckRollup: [], ...o });

test('GitHub: state, review, mergeable and check counts', () => {
  const s = ps.parseStatus('github', gh({ statusCheckRollup: [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'StatusContext', state: 'SUCCESS' }, { __typename: 'StatusContext', state: 'PENDING' }] }));
  assert.deepStrictEqual(s.checks, { passed: 2, failed: 1, pending: 2 });
  assert.strictEqual(s.state, 'open'); assert.strictEqual(s.review, 'approved'); assert.strictEqual(s.mergeable, 'yes');
  assert.match(ps.describe(s), /PR #7 open · 1 of 5 checks failed · approved/);
  assert.strictEqual(ps.parseStatus('github', gh({ isDraft: true })).state, 'draft');
  assert.strictEqual(ps.parseStatus('github', gh({ state: 'MERGED' })).state, 'merged');
  assert.strictEqual(ps.parseStatus('github', gh({ reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING' })).mergeable, 'conflicts');
  assert.strictEqual(ps.parseStatus('github', gh({ reviewDecision: '' })).review, 'none');
});

test('Azure DevOps: status, votes, merge status, url', () => {
  const az = (o) => JSON.stringify([{ pullRequestId: 42, title: 'T', status: 'active', isDraft: false, mergeStatus: 'succeeded', reviewers: [{ vote: 10 }, { vote: 0 }], repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' }, ...o }]);
  const s = ps.parseStatus('azure', az());
  assert.strictEqual(s.url, 'https://dev.azure.com/o/p/_git/r/pullrequest/42');
  assert.strictEqual(s.review, 'approved'); assert.strictEqual(s.mergeable, 'yes'); assert.strictEqual(s.checks, null);
  assert.strictEqual(ps.parseStatus('azure', az({ reviewers: [{ vote: -10 }] })).review, 'changes');
  assert.strictEqual(ps.parseStatus('azure', az({ status: 'completed' })).state, 'merged');
  assert.strictEqual(ps.parseStatus('azure', az({ status: 'abandoned' })).state, 'closed');
  assert.strictEqual(ps.parseStatus('azure', '[]').found, false);
  assert.strictEqual(ps.describe(s), 'PR #42 open · approved');
});

test('garbage output is an error, not a crash or a fake status', () => {
  assert.throws(() => ps.parseStatus('github', 'not json'), /unexpected output/);
  assert.strictEqual(ps.parseStatus('github', 'null').found, false);
  assert.strictEqual(ps.parseStatus('gitlab', '{}').found, false);
});

test('commands are argument arrays for the right host', () => {
  assert.deepStrictEqual(ps.statusCommand({ host: 'github' }, 'agent/x').args.slice(0, 3), ['pr', 'view', 'agent/x']);
  const az = ps.statusCommand(parseRemote('https://dev.azure.com/o/p/_git/r'), 'agent/x');
  assert.strictEqual(az.bin, 'az'); assert.ok(az.args.includes('agent/x')); assert.ok(az.args.includes('https://dev.azure.com/o'));
  assert.strictEqual(ps.statusCommand({ host: 'unknown' }, 'b'), null);
});

test('work items: GitHub issues, Azure boards, Jira keys; no false positives', () => {
  const gh1 = parseRemote('git@github.com:o/r.git');
  const a = ps.extractWorkItems(['fix #12 and #12 again', 'color #fff', 'see https://x/y#34', 'UTF-8 and PROJ-77'], gh1, { jiraBaseUrl: 'https://j.example.com/' });
  assert.deepStrictEqual(a.map((w) => w.key), ['#12', 'PROJ-77']);
  assert.strictEqual(a[0].url, 'https://github.com/o/r/issues/12');
  assert.strictEqual(a[1].url, 'https://j.example.com/browse/PROJ-77');
  const az1 = parseRemote('https://dev.azure.com/org/My Project/_git/r');
  const b = ps.extractWorkItems(['AB#5 relates to #6'], az1);
  assert.deepStrictEqual(b.map((w) => w.url), ['https://dev.azure.com/org/My%20Project/_workitems/edit/5', 'https://dev.azure.com/org/My%20Project/_workitems/edit/6']);
  assert.strictEqual(ps.extractWorkItems(['PROJ-1'], {})[0].url, null); // no base url, no link
  assert.strictEqual(ps.extractWorkItems(['PROJ-1'], {}, { jiraBaseUrl: 'javascript:alert(1)' })[0].url, null);
  assert.deepStrictEqual(ps.extractWorkItems([null, undefined, ''], gh1), []);
});

test('fetchStatus: work items come from branch, task and commits; CLI missing and "no PR" are reported plainly', async () => {
  const root = repo({ 'a.txt': 'x\n' });
  sh(root, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  const run = await runs.createRun(root, { name: 'fix PROJ-5', task: 'Implements #9', agent: 'A' });
  require('fs').writeFileSync(require('path').join(run.top, 'b.txt'), 'y');
  sh(run.top, 'add', '-A'); sh(run.top, 'commit', '-qm', 'Closes #11');
  const exec = async () => ({ stdout: gh() });
  const ok = await ps.fetchStatus(root, run.id, { exec, jiraBaseUrl: 'https://j.example.com' });
  assert.deepStrictEqual(ok.workItems.map((w) => w.key).sort(), ['#11', '#9', 'PROJ-5']);
  assert.strictEqual(ok.pr.number, 7); assert.match(ok.text, /PR #7 open/);
  const missing = await ps.fetchStatus(root, run.id, { exec: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } });
  assert.strictEqual(missing.error, 'cli-missing'); assert.match(missing.text, /"gh" is not installed/);
  const none = await ps.fetchStatus(root, run.id, { exec: async () => { const e = new Error('x'); e.stderr = 'no pull requests found for branch "agent/fix-proj-5"'; throw e; } });
  assert.strictEqual(none.text, 'No pull request yet'); assert.strictEqual(none.error, undefined);
  const bad = await ps.fetchStatus(root, run.id, { exec: async () => { const e = new Error('x'); e.stderr = 'HTTP 401: bad credentials\nrun gh auth login'; throw e; } });
  assert.strictEqual(bad.error, 'failed'); assert.match(bad.text, /auth login/);
});
