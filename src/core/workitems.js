'use strict';
/**
 * Work items from Azure Boards, to hand to an agent as its task (via `az boards`; nothing is written back).
 * The parsers and builders are pure and take the CLI's JSON; only list()/show() run the CLI.
 */
const pr = require('./pr');

const DONE_STATES = ['Closed', 'Done', 'Removed', 'Resolved', 'Completed'];
const TYPES = ['User Story', 'Bug', 'Task', 'Product Backlog Item', 'Issue', 'Feature'];
const COLUMNS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo', 'System.Tags'];

/** Where the work items live: the origin remote when it is Azure DevOps, else .ide/config.json `workItems: { orgUrl, project }`. */
function target(remote, cfg = {}) {
  if (remote && remote.host === 'azure') return { orgUrl: remote.orgUrl, project: remote.project };
  const w = (cfg && cfg.workItems) || {};
  if (/^https:\/\//.test(String(w.orgUrl || '')) && w.project) return { orgUrl: String(w.orgUrl).replace(/\/+$/, ''), project: String(w.project) };
  return null;
}

const q = (s) => String(s).replace(/'/g, "''");

/** WIQL for a list. scope: 'mine' (assigned to me, not finished) or 'sprint' (the current iteration of the project's default team, everybody). */
function wiql(scope = 'mine', project = '') {
  const where = [`[System.TeamProject] = '${q(project)}'`, `[System.WorkItemType] IN (${TYPES.map((t) => `'${t}'`).join(', ')})`, `[System.State] NOT IN (${DONE_STATES.map((t) => `'${t}'`).join(', ')})`];
  if (scope === 'sprint') where.push('[System.IterationPath] = @CurrentIteration');
  else where.push('[System.AssignedTo] = @Me');
  return `SELECT ${COLUMNS.map((c) => `[${c}]`).join(', ')} FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;
}

const person = (v) => (v && typeof v === 'object' ? v.displayName || v.uniqueName || '' : String(v || ''));

/** `az boards query` JSON -> [{ id, title, type, state, assignedTo, tags }] */
function parseList(stdout) {
  let j;
  try { j = JSON.parse(String(stdout || '').trim() || '[]'); } catch { throw new Error('Could not read the work items (unexpected output from az).'); }
  return (Array.isArray(j) ? j : []).map((w) => {
    const f = (w && w.fields) || {};
    return { id: Number(w.id || f['System.Id']), title: String(f['System.Title'] || ''), type: String(f['System.WorkItemType'] || ''), state: String(f['System.State'] || ''), assignedTo: person(f['System.AssignedTo']), tags: String(f['System.Tags'] || '') };
  }).filter((w) => w.id);
}

/** Azure Boards fields are HTML. Text with line breaks, list items as "- ", entities decoded. */
function htmlToText(html) {
  return String(html || '')
    .replace(/\r/g, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|table)>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** `az boards work-item show` JSON -> the parts an agent needs. */
function parseItem(stdout, orgUrl = '', project = '') {
  let j;
  try { j = JSON.parse(String(stdout || '').trim() || 'null'); } catch { throw new Error('Could not read the work item (unexpected output from az).'); }
  if (!j || !j.id) throw new Error('That work item was not found.');
  const f = j.fields || {};
  const field = (n) => htmlToText(f[n]);
  return {
    id: Number(j.id), title: String(f['System.Title'] || ''), type: String(f['System.WorkItemType'] || ''), state: String(f['System.State'] || ''),
    assignedTo: person(f['System.AssignedTo']), tags: String(f['System.Tags'] || ''),
    description: field('System.Description'), acceptance: field('Microsoft.VSTS.Common.AcceptanceCriteria'), repro: field('Microsoft.VSTS.TCM.ReproSteps'), systemInfo: field('Microsoft.VSTS.TCM.SystemInfo'),
    url: (j._links && j._links.html && j._links.html.href) || (orgUrl && project ? `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${j.id}` : null),
  };
}

/** The text that becomes a workflow's input or an agent's task. AB#id links the pull request back to the work item. */
function toTask(item, { max = 6000 } = {}) {
  const parts = [`${item.type || 'Work item'} AB#${item.id}: ${item.title}`];
  if (item.description) parts.push(item.description);
  if (item.repro) parts.push(`Steps to reproduce:\n${item.repro}`);
  if (item.acceptance) parts.push(`Acceptance criteria:\n${item.acceptance}`);
  if (item.systemInfo) parts.push(`System info:\n${item.systemInfo}`);
  const text = parts.join('\n\n');
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}\n[…shortened; the full text is in Azure Boards${item.url ? `: ${item.url}` : ''}]` : text;
}

/** A readable reason for the failures people actually hit. */
function explain(err, bin = 'az') {
  if (err && err.code === 'ENOENT') return `"${bin}" is not installed. Install the Azure CLI, then run: az extension add --name azure-devops`;
  const msg = String((err && (err.stderr || err.stdout || err.message)) || err || '').trim();
  if (/is misspelled or not recognized|'boards' is not in the|invalid_choice|az devops/i.test(msg) && /boards|devops/i.test(msg)) return 'The Azure DevOps extension is missing. Run: az extension add --name azure-devops';
  if (/az login|Please run 'az login'|AADSTS|not logged in|TF400813|authorization|401|403/i.test(msg)) return 'Not signed in to Azure DevOps. Run: az login (or: az devops login) and try again.';
  return msg.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240) || 'az failed.';
}

async function list(root, { scope = 'mine', cfg = {}, env, exec = pr.run } = {}) {
  const remote = await pr.remoteInfo(root);
  const t = target(remote, cfg);
  if (!t) return { error: 'No Azure DevOps project found. The origin remote is not on dev.azure.com; set { "workItems": { "orgUrl": "https://dev.azure.com/yourorg", "project": "YourProject" } } in .ide/config.json.' };
  try {
    const { stdout } = await exec('az', ['boards', 'query', '--wiql', wiql(scope, t.project), '--organization', t.orgUrl, '--project', t.project, '--output', 'json'], { cwd: root, env });
    return { items: parseList(stdout), org: t.orgUrl, project: t.project };
  } catch (err) { return { error: explain(err) }; }
}

async function show(root, id, { cfg = {}, env, exec = pr.run } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { error: 'Not a work item number.' };
  const remote = await pr.remoteInfo(root);
  const t = target(remote, cfg);
  if (!t) return { error: 'No Azure DevOps project found for this repository.' };
  try {
    const { stdout } = await exec('az', ['boards', 'work-item', 'show', '--id', String(n), '--organization', t.orgUrl, '--output', 'json'], { cwd: root, env });
    const item = parseItem(stdout, t.orgUrl, t.project);
    return { item, text: toTask(item) };
  } catch (err) { return { error: err && err.message && /not found|unexpected output/.test(err.message) ? err.message : explain(err) }; }
}

/** Adds a discussion comment to a work item (`az boards work-item update --discussion`). Only called when the person asked for it. */
async function comment(root, id, text, { cfg = {}, env, exec = pr.run } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { error: 'Not a work item number.' };
  const t = String(text || '').replace(/\r/g, '').trim().slice(0, 4000);
  if (!t) return { error: 'Nothing to post.' };
  const remote = await pr.remoteInfo(root);
  const tg = target(remote, cfg);
  if (!tg) return { error: 'No Azure DevOps project found for this repository.' };
  try {
    await exec('az', ['boards', 'work-item', 'update', '--id', String(n), '--discussion', t, '--organization', tg.orgUrl, '--output', 'none'], { cwd: root, env });
    return { ok: true };
  } catch (err) { return { error: explain(err) }; }
}

module.exports = { comment, target, wiql, parseList, parseItem, htmlToText, toTask, explain, list, show, DONE_STATES, TYPES };
