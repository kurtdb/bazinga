'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/core/container');

const base = () => ({ settings: c.normalizeSettings({}), worktree: '/r.worktrees/fix-1', commonGitDir: '/r/.git', worktreeGitDir: '/r/.git/worktrees/fix-1', runId: 'fix-1' });

test('normalizeSettings: defaults, passEnv as text, validation', () => {
  assert.equal(c.normalizeSettings({}).image, 'bazinga-agent:latest');
  assert.deepEqual(c.normalizeSettings({ passEnv: 'A_B, C' }).passEnv, ['A_B', 'C']);
  assert.throws(() => c.normalizeSettings({ image: 'x; rm -rf /' }), /image/);
  assert.throws(() => c.normalizeSettings({ network: 'host' }), /Network/);
  assert.throws(() => c.normalizeSettings({ memory: '4 gigs' }), /Memory/);
  assert.throws(() => c.normalizeSettings({ cpus: '$(x)' }), /CPU/);
  assert.throws(() => c.normalizeSettings({ passEnv: ['A-B'] }), /variable name/);
});

test('buildRunArgs: hardened, mounts only the worktree and the git data, env by name only', () => {
  const a = c.buildRunArgs(base());
  const line = a.join(' ');
  for (const must of ['--rm', '--cap-drop ALL', 'no-new-privileges', '--pids-limit 512', '--memory 4g', '--cpus 2', '--network bridge', '-v /r.worktrees/fix-1:/work', '-v /r/.git:/gitcommon', 'GIT_DIR=/gitcommon/worktrees/fix-1', 'bazinga.run=fix-1']) assert.ok(line.includes(must), must);
  assert.equal(a.filter((x) => x === '-v').length, 3, 'worktree, git data, home volume: nothing else');
  assert.ok(!line.includes('--privileged') && !line.includes('--network host') && !line.includes('docker.sock'));
  assert.equal(a[a.length - 1], 'bazinga-agent:latest');
  // env values are never on the command line
  const envArgs = a.filter((x, i) => a[i - 1] === '-e' && !x.includes('='));
  assert.ok(envArgs.includes('BAZINGA_TASK') && envArgs.includes('ANTHROPIC_API_KEY') && envArgs.includes('GIT_AUTHOR_NAME'));
  assert.ok(!a.some((x) => /sk-/.test(x)));
  const withUser = c.buildRunArgs({ ...base(), user: { uid: 1001, gid: 1001 } });
  assert.deepEqual(withUser.slice(withUser.indexOf('--user'), withUser.indexOf('--user') + 2), ['--user', '1001:1001']);
  assert.ok(c.buildRunArgs({ ...base(), settings: c.normalizeSettings({ network: 'none' }) }).join(' ').includes('--network none'));
});

test('buildRunArgs: refuses unsafe paths and a git dir outside the repository', () => {
  assert.throws(() => c.buildRunArgs({ ...base(), worktree: '/a"b' }), /cannot be mounted/);
  assert.throws(() => c.buildRunArgs({ ...base(), worktree: '/a\nb' }), /cannot be mounted/);
  assert.throws(() => c.buildRunArgs({ ...base(), worktreeGitDir: '/elsewhere/.git/worktrees/x' }), /not inside/);
  assert.throws(() => c.buildRunArgs({ ...base(), worktreeGitDir: '/r/.git' }), /not inside/);
});

test('quote / toShellLine per shell, including spaces and quotes', () => {
  assert.equal(c.quote('plain-1.2/x', 'posix'), 'plain-1.2/x');
  assert.equal(c.quote('a b', 'posix'), "'a b'");
  assert.equal(c.quote("it's", 'posix'), `'it'\\''s'`);
  assert.equal(c.quote("it's", 'ps'), "'it''s'");
  assert.equal(c.quote('C:\\my repo\\x', 'cmd'), '"C:\\my repo\\x"');
  assert.throws(() => c.quote('100%', 'cmd') && c.quote('a"b', 'cmd'), /cmd/);
  const line = c.toShellLine(['run', '-v', 'C:\\my repo:/work', 'img'], 'ps');
  assert.equal(line, "docker run -v 'C:\\my repo:/work' img");
});

test('agentCommandFor: the task template gets the container-side variable; agents without one run as they are', () => {
  assert.equal(c.agentCommandFor({ command: 'claude' }, 'claude {task}'), 'claude "$BAZINGA_TASK"');
  assert.equal(c.agentCommandFor({ command: 'copilot' }, ''), 'copilot');
});

test('with a real worktree: the mount layout works for git through GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE', async () => {
  const { repo, sh } = require('./helpers');
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const runs = require('../src/core/runs');
  const root = repo({ 'a.txt': 'one\n' });
  const run = await runs.createRun(root, { name: 'fix one', task: 't' });
  const common = await runs.commonGitDir(run.root);
  const gitdir = path.resolve(run.root, sh(run.root, 'rev-parse', '--git-dir').trim());
  const args = c.buildRunArgs({ settings: c.normalizeSettings({}), worktree: run.root, commonGitDir: common, worktreeGitDir: gitdir, runId: run.id });
  const envOf = (n) => args.find((x) => x.startsWith(`${n}=`)).split('=')[1];
  // inside the container the paths are /work and /gitcommon/...; here we map them back to the host paths to prove the relative layout is right
  assert.equal(path.join(common, envOf('GIT_DIR').replace('/gitcommon/', '')), gitdir);
  const env = { ...process.env, GIT_DIR: gitdir, GIT_COMMON_DIR: common, GIT_WORK_TREE: run.root, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' };
  fs.writeFileSync(path.join(run.root, 'b.txt'), 'two\n');
  execFileSync('git', ['add', '-A'], { cwd: run.root, env });
  execFileSync('git', ['commit', '-q', '-m', 'in container'], { cwd: run.root, env });
  assert.match(sh(root, 'log', '--oneline', run.branch), /in container/);
});

test('setupStep walks from "no Docker" to "ready"', () => {
  const c = require('../src/core/container');
  assert.equal(c.setupStep({ docker: false, image: false, enabled: false }).step, 'install');
  assert.equal(c.setupStep({ docker: true, image: false, enabled: false }).step, 'build');
  assert.deepEqual(c.setupStep({ docker: true, image: true, enabled: false }).step, 'enable');
  const ready = c.setupStep({ docker: true, image: true, enabled: true });
  assert.equal(ready.step, 'ready'); assert.equal(ready.ok, true);
});

test('buildArgs: validates image and folder; the image files exist where the app expects them', () => {
  const c = require('../src/core/container');
  const fs = require('node:fs'); const path = require('node:path');
  assert.deepEqual(c.buildArgs('bazinga-agent:latest', '/tmp/x'), ['build', '-t', 'bazinga-agent:latest', '/tmp/x']);
  assert.throws(() => c.buildArgs('bad image; rm', '/tmp/x'), /image name/);
  assert.throws(() => c.buildArgs('ok', '/tmp/"x'), /cannot be used/);
  for (const f of c.CONTEXT_FILES) assert.ok(fs.existsSync(path.join(__dirname, '..', 'docker', 'agent', f)), f);
  assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).build.files.includes('docker/**'), 'the image files must ship with the app');
});

test('unattended runs use the container when it is ready, without switching it on for everything', () => {
  const { containerDecision } = require('../src/core/container');
  assert.deepEqual(containerDecision({ enabled: false, unattended: true, ready: true }), { use: true, why: 'auto' });
  assert.deepEqual(containerDecision({ enabled: false, unattended: true, ready: false }), { use: false, why: 'not-ready' });
  assert.deepEqual(containerDecision({ enabled: false, unattended: true, setting: 'off', ready: true }), { use: false, why: 'off' });
  assert.deepEqual(containerDecision({ enabled: false, unattended: false, ready: true }), { use: false, why: 'attended' });
  assert.deepEqual(containerDecision({ enabled: true, unattended: false, ready: false }), { use: true, why: 'setting' });
});
test('the renderer copy of the container rule gives the same answers as the core one', () => {
  const { containerDecision } = require('../src/core/container');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/renderer/app.js'), 'utf8');
  const body = /function containerDecisionUi\(([\s\S]*?)\n  }\n/.exec(src);
  assert.ok(body);
  const f = new Function(`function containerDecisionUi(${body[1]}\n}\nreturn containerDecisionUi;`)();
  for (const enabled of [true, false]) for (const unattended of [true, false]) for (const setting of ['auto', 'off']) for (const ready of [true, false]) {
    assert.deepEqual(f({ enabled, unattended, setting, ready }), containerDecision({ enabled, unattended, setting, ready }));
  }
});
