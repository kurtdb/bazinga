'use strict';
/**
 * Run an agent inside a Docker container instead of directly on your machine.
 *
 * What the container sees: the run's worktree (/work), the repository's git data (/gitcommon, needed to commit), a persistent
 * home volume for the agent's own login/config, and only the environment variables named in `passEnv`. It does NOT see your
 * home folder, ssh keys, cloud credentials, other projects or the IDE's data. Capabilities are dropped and the process
 * count/memory/cpu are limited. Network is on (the agent needs its API) unless you choose "none".
 * What it does not protect: the repository itself (the agent can rewrite its branch and, through /gitcommon, other refs),
 * and anything the agent sends over the network.
 */
const path = require('node:path');

const NETWORKS = ['bridge', 'none'];
const IMAGE_RE = /^[a-z0-9][a-z0-9._\-/:@]{0,200}$/i;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GIT_IDENTITY_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const HOME_VOLUME = 'bazinga-agent-home';

const DEFAULTS = { enabled: false, image: 'bazinga-agent:latest', network: 'bridge', memory: '4g', cpus: '2', passEnv: ['ANTHROPIC_API_KEY'] };

/** Settings merged with defaults and validated; throws a readable error for anything that would end up on a command line. */
function normalizeSettings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!IMAGE_RE.test(String(s.image))) throw new Error(`Not a valid image name: ${s.image}`);
  if (!NETWORKS.includes(s.network)) throw new Error(`Network must be one of: ${NETWORKS.join(', ')}`);
  if (!/^\d+[kmg]?$/i.test(String(s.memory))) throw new Error(`Memory limit like 4g or 512m, not "${s.memory}"`);
  if (!/^\d+(\.\d+)?$/.test(String(s.cpus))) throw new Error(`CPU limit like 2 or 1.5, not "${s.cpus}"`);
  const passEnv = (Array.isArray(s.passEnv) ? s.passEnv : String(s.passEnv || '').split(/[\s,]+/)).map(String).filter(Boolean);
  for (const n of passEnv) if (!ENV_RE.test(n)) throw new Error(`Not a valid environment variable name: ${n}`);
  return { enabled: !!s.enabled, image: String(s.image), network: s.network, memory: String(s.memory), cpus: String(s.cpus), passEnv: [...new Set(passEnv)] };
}

const badPath = (p) => /["\r\n\0%]/.test(p);

/**
 * @param {object} o
 * @param {object} o.settings  normalizeSettings() output
 * @param {string} o.worktree  absolute host path of the run's worktree
 * @param {string} o.commonGitDir absolute host path of the repository's common git dir
 * @param {string} o.worktreeGitDir absolute host path of this worktree's git dir (inside commonGitDir/worktrees/...)
 * @param {{uid:number,gid:number}|null} [o.user]  run as this user (Linux); null = the image's user
 * @returns {string[]} arguments after `docker`
 */
function buildRunArgs({ settings, worktree, commonGitDir, worktreeGitDir, user = null, runId = '' }) {
  for (const p of [worktree, commonGitDir, worktreeGitDir]) if (!p || badPath(p)) throw new Error(`The path cannot be mounted: ${p}`);
  const rel = path.relative(commonGitDir, worktreeGitDir).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('The worktree’s git folder is not inside the repository’s git folder.');
  const args = ['run', '--rm', '-it', '--init',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512',
    '--memory', settings.memory, '--cpus', settings.cpus, '--network', settings.network];
  if (runId && /^[A-Za-z0-9._-]+$/.test(runId)) args.push('--label', `bazinga.run=${runId}`);
  if (user) args.push('--user', `${user.uid}:${user.gid}`);
  args.push('-v', `${worktree}:/work`, '-w', '/work', '-v', `${commonGitDir}:/gitcommon`, '-v', `${HOME_VOLUME}:/home/agent`);
  args.push('-e', 'HOME=/home/agent', '-e', 'GIT_WORK_TREE=/work', '-e', 'GIT_COMMON_DIR=/gitcommon', '-e', `GIT_DIR=/gitcommon/${rel}`);
  const names = ['BAZINGA_TASK', 'BAZINGA_AGENT_CMD', ...GIT_IDENTITY_VARS, ...settings.passEnv];
  for (const n of [...new Set(names)]) args.push('-e', n); // name only: the value comes from the terminal's environment, never from the command line
  args.push(settings.image);
  return args;
}

/** Quote one token for the shell the terminal runs. */
function quote(token, shell) {
  const t = String(token);
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(t)) return t;
  if (/[\r\n\0]/.test(t)) throw new Error('Cannot quote a value with a line break.');
  if (shell === 'cmd') { if (/["%]/.test(t)) throw new Error(`Cannot quote this for cmd.exe: ${t}`); return `"${t}"`; }
  if (shell === 'ps') return `'${t.replace(/'/g, "''")}'`;
  return `'${t.replace(/'/g, `'\\''`)}'`;
}

const toShellLine = (args, shell = 'posix') => ['docker', ...args].map((a) => quote(a, shell)).join(' ');

/** The command the agent runs inside the container (eval'd by the image's entrypoint): its task template with $BAZINGA_TASK. */
function agentCommandFor(agent, taskTemplate) {
  if (taskTemplate) return String(taskTemplate).split('{task}').join('"$BAZINGA_TASK"');
  return String(agent && agent.command || '');
}

/** Files of the agent image, written to a folder for `docker build` (Docker cannot read them from inside the app package). */
const CONTEXT_FILES = ['Dockerfile', 'bazinga-run'];
const buildArgs = (image, dir) => {
  if (!IMAGE_RE.test(String(image))) throw new Error(`Not a valid image name: ${image}`);
  if (!dir || badPath(dir)) throw new Error(`The folder cannot be used: ${dir}`);
  return ['build', '-t', String(image), dir];
};

/** What the person should do next, from the facts: { docker, image } (image = built locally) and whether it is switched on. */
function setupStep({ docker, image, enabled }) {
  if (!docker) return { step: 'install', ok: false, text: 'Docker was not found. Install Docker Desktop (or Docker Engine), start it, then check again.' };
  if (!image) return { step: 'build', ok: false, text: 'Docker is there, the agent image is not built yet. Building takes a few minutes the first time.' };
  if (!enabled) return { step: 'enable', ok: true, text: 'Ready. Switch it on to run agent runs in the container.' };
  return { step: 'ready', ok: true, text: 'Ready: agent runs start in the container.' };
}

/**
 * Unattended runs (nobody watching) go into the container when it is ready, even if the container is not switched on for everything.
 * @returns {{use:boolean, why:'setting'|'auto'|'off'|'not-ready'|'attended'}}
 */
function containerDecision({ enabled, unattended, setting = 'auto', ready }) {
  if (enabled) return { use: true, why: 'setting' };
  if (!unattended) return { use: false, why: 'attended' };
  if (setting === 'off') return { use: false, why: 'off' };
  return ready ? { use: true, why: 'auto' } : { use: false, why: 'not-ready' };
}

module.exports = { containerDecision, CONTEXT_FILES, buildArgs, setupStep, DEFAULTS, GIT_IDENTITY_VARS, HOME_VOLUME, normalizeSettings, buildRunArgs, quote, toShellLine, agentCommandFor };
