'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseRemote, prCommand, extractUrl, createPr } = require('../src/core/pr');
const { createRun } = require('../src/core/runs');

test('remote urls: GitHub and Azure DevOps in all their spellings', () => {
  assert.deepStrictEqual(parseRemote('https://github.com/kurt/bazinga.git'), { host: 'github', owner: 'kurt', repo: 'bazinga' });
  assert.deepStrictEqual(parseRemote('git@github.com:kurt/bazinga.git'), { host: 'github', owner: 'kurt', repo: 'bazinga' });
  const az = { host: 'azure', org: 'wave', project: 'My Project', repo: 'api', orgUrl: 'https://dev.azure.com/wave' };
  assert.deepStrictEqual(parseRemote('https://wave@dev.azure.com/wave/My%20Project/_git/api'), az);
  assert.deepStrictEqual(parseRemote('git@ssh.dev.azure.com:v3/wave/My%20Project/api'), az);
  assert.strictEqual(parseRemote('https://wave.visualstudio.com/Proj/_git/api').orgUrl, 'https://wave.visualstudio.com');
  assert.strictEqual(parseRemote('https://gitlab.com/a/b.git').host, 'gitlab');
  assert.strictEqual(parseRemote('/some/local/path').host, 'unknown');
});

test('PR commands are argument arrays (titles with quotes and newlines are safe)', () => {
  const gh = prCommand({ host: 'github' }, { branch: 'agent/x', base: 'main', title: 'Fix "quotes" & $(rm -rf)', body: 'line1\nline2', draft: true });
  assert.strictEqual(gh.bin, 'gh');
  assert.ok(gh.args.includes('Fix "quotes" & $(rm -rf)') && gh.args.includes('--draft'));
  const az = prCommand({ host: 'azure', orgUrl: 'https://dev.azure.com/o', project: 'P', repo: 'R' }, { branch: 'agent/x', base: 'develop', title: 't', body: '' });
  assert.strictEqual(az.bin, 'az');
  assert.deepStrictEqual(az.args.slice(az.args.indexOf('--target-branch'), az.args.indexOf('--target-branch') + 2), ['--target-branch', 'develop']);
  assert.strictEqual(prCommand({ host: 'gitlab' }, {}), null);
});

test('PR url extraction: gh prints the url, az prints json', () => {
  assert.strictEqual(extractUrl('github', 'Creating pull request\nhttps://github.com/k/r/pull/12\n'), 'https://github.com/k/r/pull/12');
  assert.strictEqual(extractUrl('azure', JSON.stringify({ pullRequestId: 7, repository: { webUrl: 'https://dev.azure.com/o/P/_git/R' } })), 'https://dev.azure.com/o/P/_git/R/pullrequest/7');
  assert.strictEqual(extractUrl('github', ''), null);
});

// ---- end to end with a bare "origin" and fake gh / az programs on PATH
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function fixture(remoteUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-pr-'));
  const origin = path.join(dir, 'origin.git');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  sh(dir, 'init', '-q', '--bare', origin);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@t'); sh(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '-m', 'init');
  sh(repo, 'remote', 'add', 'origin', origin);
  sh(repo, 'push', '-q', '-u', 'origin', 'main');
  if (remoteUrl) sh(repo, 'config', `url.${origin}.insteadOf`, remoteUrl), sh(repo, 'remote', 'set-url', 'origin', remoteUrl);
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const fake = (name, body) => { const p = path.join(bin, name); fs.writeFileSync(p, `#!/bin/sh\n${body}\n`); fs.chmodSync(p, 0o755); };
  return { dir, origin, repo, bin, fake };
}

test('createPr: commits, pushes the branch to origin and runs gh', { skip: process.platform === 'win32' }, async () => {
  const f = fixture('https://github.com/kurt/demo.git');
  f.fake('gh', `echo "$@" > "${f.dir}/gh-args"\necho https://github.com/kurt/demo/pull/5`);
  const run = await createRun(f.repo, { name: 'login cleanup', task: 't' });
  fs.writeFileSync(path.join(run.root, 'b.txt'), 'new\n');
  const res = await createPr(f.repo, run.id, { title: 'Agent: login cleanup', body: 'Body text', env: { ...process.env, PATH: `${f.bin}${path.delimiter}${process.env.PATH}` } });
  assert.strictEqual(res.url, 'https://github.com/kurt/demo/pull/5');
  assert.strictEqual(res.host, 'github');
  assert.match(sh(f.origin, 'branch', '--list', 'agent/login-cleanup'), /agent\/login-cleanup/);
  assert.strictEqual(sh(f.origin, 'show', 'agent/login-cleanup:b.txt'), 'new');
  const args = fs.readFileSync(path.join(f.dir, 'gh-args'), 'utf8');
  assert.match(args, /pr create --base main --head agent\/login-cleanup --title Agent: login cleanup/);
});

test('createPr: a missing CLI still leaves the branch pushed and says so', { skip: process.platform === 'win32' }, async () => {
  const f = fixture('https://github.com/kurt/demo.git');
  const run = await createRun(f.repo, { name: 'x', task: 't' });
  fs.writeFileSync(path.join(run.root, 'b.txt'), 'new\n');
  const onlyGit = path.join(f.dir, 'only-git'); fs.mkdirSync(onlyGit);
  fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(onlyGit, 'git'));
  await assert.rejects(() => createPr(f.repo, run.id, { env: { ...process.env, PATH: onlyGit } }), /was pushed, but "gh" is not installed/);
  assert.match(sh(f.origin, 'branch', '--list', 'agent/x'), /agent\/x/);
});

test('createPr: an empty run and a repo without origin are refused with clear messages', { skip: process.platform === 'win32' }, async () => {
  const f = fixture('https://github.com/kurt/demo.git');
  const run = await createRun(f.repo, { name: 'empty', task: 't' });
  await assert.rejects(() => createPr(f.repo, run.id, { env: process.env }), /no changes/);
  sh(f.repo, 'remote', 'remove', 'origin');
  await assert.rejects(() => createPr(f.repo, run.id, {}), /no "origin" remote/);
});

test('createPr: unknown host pushes only', { skip: process.platform === 'win32' }, async () => {
  const f = fixture();
  const run = await createRun(f.repo, { name: 'plain', task: 't' });
  fs.writeFileSync(path.join(run.root, 'b.txt'), 'new\n');
  const res = await createPr(f.repo, run.id, {});
  assert.strictEqual(res.url, null);
  assert.match(res.output, /was pushed/);
});
