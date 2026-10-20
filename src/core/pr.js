'use strict';
/**
 * Open a pull request for an agent run: commit what is left, push the branch, call the host's CLI.
 *  GitHub        -> gh pr create
 *  Azure DevOps  -> az repos pr create (needs the azure-devops extension: az extension add --name azure-devops)
 *  anything else -> the branch is pushed and you get the compare hint
 * Nothing is run through a shell: arguments are passed as an array, so titles and bodies can contain anything.
 */
const { execFile } = require('node:child_process');
const { git } = require('./git');
const { findRun } = require('./runs');

const trim = (s) => String(s).trim();

function parseRemote(url) {
  const u = trim(url);
  let m;
  if ((m = /^(?:https?:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(u))) return { host: 'github', owner: m[1], repo: m[2] };
  if ((m = /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i.exec(u))) return { host: 'azure', org: m[1], project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), orgUrl: `https://dev.azure.com/${m[1]}` };
  if ((m = /^(?:ssh:\/\/)?(?:[^@]+@)?(?:ssh\.)?dev\.azure\.com[:/](?:v3\/)?([^/]+)\/([^/]+)\/([^/]+?)\/?$/i.exec(u))) return { host: 'azure', org: m[1], project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), orgUrl: `https://dev.azure.com/${m[1]}` };
  if ((m = /^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i.exec(u))) return { host: 'azure', org: m[1], project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), orgUrl: `https://${m[1]}.visualstudio.com` };
  if (/gitlab/i.test(u)) return { host: 'gitlab' };
  return { host: 'unknown' };
}

/** The command (without shell) that creates the PR; pure, so it can be tested without any CLI installed. */
function prCommand(remote, { branch, base, title, body, draft }) {
  if (remote.host === 'github') {
    return { bin: 'gh', args: ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body || '', ...(draft ? ['--draft'] : [])] };
  }
  if (remote.host === 'azure') {
    return { bin: 'az', args: ['repos', 'pr', 'create', '--organization', remote.orgUrl, '--project', remote.project, '--repository', remote.repo, '--source-branch', branch, '--target-branch', base, '--title', title, '--description', body || '', '--output', 'json', ...(draft ? ['--draft', 'true'] : [])] };
  }
  return null;
}

/** One argument for cmd.exe: with a shell Node joins the arguments with spaces and quotes nothing, so a title or a query with spaces fell apart. */
function quoteWin(arg) {
  const a = String(arg);
  if (a !== '' && !/[\s"&|<>^()%!,;=]/.test(a)) return a;
  if (/[%"\r\n]/.test(a)) throw new Error('A value with a double quote, a percent sign or a line break cannot be passed through cmd.exe safely.');
  return `"${a}"`;
}

function run(bin, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const viaShell = process.platform === 'win32' && bin === 'az';
    // .cmd shims (gh.cmd, az.cmd) on Windows need a shell: there every argument is quoted for cmd.exe (see quoteWin)
    try { if (viaShell) args = args.map(quoteWin); } catch (err) { reject(err); return; }
    execFile(bin, args, { cwd, env: env || process.env, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: viaShell }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; err.stdout = stdout; reject(err); } else resolve({ stdout, stderr });
    });
  });
}

function extractUrl(host, output) {
  const text = String(output || '');
  if (host === 'azure') {
    try {
      const j = JSON.parse(text);
      const id = j.pullRequestId;
      const repoUrl = j.repository && j.repository.webUrl;
      if (id && repoUrl) return `${repoUrl}/pullrequest/${id}`;
    } catch { /* fall through */ }
  }
  const m = /https?:\/\/\S+/.exec(text);
  return m ? m[0].replace(/[)\].,]+$/, '') : null;
}

async function remoteInfo(root) {
  let url = '';
  // the url as written: `remote get-url` would apply insteadOf rewrites
  try { url = trim(await git(root, ['config', '--get', 'remote.origin.url'])); } catch { return { name: null, url: '', ...parseRemote('') }; }
  return { name: 'origin', url, ...parseRemote(url) };
}

/**
 * @returns {{ url: string|null, host: string, pushed: string, output: string }}
 */
async function createPr(root, id, { title, body, base, draft = false, env } = {}) {
  const { run: r, main } = await findRun(root, id);
  const remote = await remoteInfo(main.top);
  if (!remote.name) throw new Error('This repository has no "origin" remote to push to.');
  const msg = trim(title || '') || `Agent run: ${r.name}`;
  const target = trim(base || '') || r.baseBranch || main.branch || 'main';

  if (trim(await git(r.top, ['status', '--porcelain'])) !== '') {
    await git(r.top, ['add', '-A']);
    await git(r.top, ['commit', '-q', '-m', msg]);
  }
  const ahead = Number(trim(await git(r.top, ['rev-list', '--count', `${r.baseCommit || target}..HEAD`]).catch(() => '1')));
  if (!ahead) throw new Error('The run has no changes to open a pull request for.');

  try { await git(r.top, ['push', '-u', 'origin', r.branch], { env }); } catch (err) {
    throw new Error(`git push failed: ${trim(err.stderr || err.message).split('\n').slice(-4).join('\n')}`);
  }

  const cmd = prCommand(remote, { branch: r.branch, base: target, title: msg, body, draft });
  if (!cmd) return { url: null, host: remote.host, pushed: r.branch, output: `Branch ${r.branch} was pushed. Create the pull request on your Git host (no CLI integration for ${remote.host}).` };
  try {
    const { stdout, stderr } = await run(cmd.bin, cmd.args, { cwd: r.top, env });
    return { url: extractUrl(remote.host, stdout || stderr), host: remote.host, pushed: r.branch, output: trim(stdout || stderr) };
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`The branch ${r.branch} was pushed, but "${cmd.bin}" is not installed${remote.host === 'azure' ? ' (install the Azure CLI and run: az extension add --name azure-devops)' : ' (https://cli.github.com)'}.`);
    throw new Error(`The branch ${r.branch} was pushed, but creating the pull request failed:\n${trim(err.stderr || err.stdout || err.message).split('\n').slice(-6).join('\n')}`);
  }
}

module.exports = { quoteWin, parseRemote, prCommand, extractUrl, remoteInfo, createPr, run };
