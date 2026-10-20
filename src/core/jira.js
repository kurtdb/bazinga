'use strict';
/**
 * Work items from Jira, to hand to an agent as its task (read-only: nothing is written back).
 * Jira Cloud: https://yourorg.atlassian.net, REST v3, email + API token (Basic). Jira Server / Data Center: REST v2, personal access token (Bearer).
 * The network call is injected (`fetchFn`), so everything here runs against a fake server in the tests.
 */
const DONE = 'statusCategory != Done';
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'labels', 'priority'];

/** Normalised connection settings, or null when the base URL is missing / not https. */
function connection(cfg = {}) {
  const j = (cfg && cfg.jira) || {};
  const baseUrl = String(j.baseUrl || (cfg.workItems && cfg.workItems.jiraBaseUrl) || '').trim().replace(/\/+$/, '');
  // credentials are sent with every request: https, or plain http only for a server on this machine
  if (!/^https:\/\/[^\s/]+/i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) return null;
  const flavor = j.flavor === 'server' ? 'server' : 'cloud';
  return { baseUrl, flavor, email: String(j.email || '').trim(), project: String(j.project || '').trim().toUpperCase(), api: flavor === 'server' ? 2 : 3 };
}

function authHeader(conn, token) {
  if (conn.flavor === 'server') return `Bearer ${token}`;
  return `Basic ${Buffer.from(`${conn.email}:${token}`).toString('base64')}`;
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** JQL for a list. 'mine': assigned to me, not done. 'sprint': the open sprint(s), everybody. */
function jql(scope = 'mine', project = '') {
  const where = [];
  if (project) where.push(`project = "${q(project)}"`);
  where.push(scope === 'sprint' ? 'sprint in openSprints()' : 'assignee = currentUser()');
  where.push(DONE);
  return `${where.join(' AND ')} ORDER BY priority DESC, updated DESC`;
}

const name = (v) => (v && typeof v === 'object' ? v.displayName || v.name || '' : String(v || ''));

/** search response -> [{ id: 'PROJ-12', key, title, type, state, assignedTo, tags }] */
function parseList(body) {
  const issues = Array.isArray(body && body.issues) ? body.issues : [];
  return issues.map((i) => {
    const f = (i && i.fields) || {};
    return { id: String(i.key || ''), key: String(i.key || ''), title: String(f.summary || ''), type: name(f.issuetype), state: name(f.status), assignedTo: name(f.assignee), tags: (Array.isArray(f.labels) ? f.labels : []).join(' ') };
  }).filter((w) => w.key);
}

/** Atlassian Document Format (REST v3 descriptions) -> text with line breaks and "- " list items. */
function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const kids = (n) => (Array.isArray(n.content) ? n.content : []);
  const inline = (n) => kids(n).map(adfToText).join('');
  switch (node.type) {
    case 'text': return node.text || '';
    case 'hardBreak': return '\n';
    case 'mention': return (node.attrs && node.attrs.text) || '';
    case 'emoji': return (node.attrs && (node.attrs.text || node.attrs.shortName)) || '';
    case 'inlineCard': return (node.attrs && node.attrs.url) || '';
    case 'paragraph': case 'heading': return `${inline(node)}\n`;
    case 'codeBlock': return `\`\`\`\n${inline(node)}\n\`\`\`\n`;
    case 'blockquote': return `${inline(node).split('\n').filter(Boolean).map((l) => `> ${l}`).join('\n')}\n`;
    case 'rule': return '---\n';
    case 'bulletList': return kids(node).map((li) => `- ${adfToText(li).trim().replace(/\n/g, '\n  ')}`).join('\n') + '\n';
    case 'orderedList': return kids(node).map((li, i) => `${i + 1}. ${adfToText(li).trim().replace(/\n/g, '\n   ')}`).join('\n') + '\n';
    case 'table': return kids(node).map((row) => kids(row).map((c) => adfToText(c).trim().replace(/\s*\n\s*/g, ' ')).join(' | ')).join('\n') + '\n';
    case 'panel': case 'expand': case 'tableCell': case 'tableHeader': case 'listItem': case 'doc': return inline(node);
    default: return inline(node);
  }
}

const clean = (t) => String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** One issue -> the parts an agent needs. v3 descriptions are ADF objects, v2 descriptions are text in Jira's own markup (kept as text). */
function parseItem(body, conn) {
  if (!body || !body.key) throw new Error('That issue was not found.');
  const f = body.fields || {};
  return {
    id: String(body.key), key: String(body.key), title: String(f.summary || ''), type: name(f.issuetype), state: name(f.status), assignedTo: name(f.assignee),
    tags: (Array.isArray(f.labels) ? f.labels : []).join(' '), priority: name(f.priority),
    description: clean(adfToText(f.description)), url: conn ? `${conn.baseUrl}/browse/${body.key}` : null,
  };
}

/** The text that becomes a workflow's input or an agent's task. The key (PROJ-12) is what links the pull request back. */
function toTask(item, { max = 6000 } = {}) {
  const parts = [`${item.type || 'Issue'} ${item.key}: ${item.title}`];
  if (item.description) parts.push(item.description);
  const text = parts.join('\n\n');
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}\n[…shortened; the full text is in Jira${item.url ? `: ${item.url}` : ''}]` : text;
}

/** A readable reason for what people actually hit. */
function explain(status, err, conn) {
  if (status === 401) return conn && conn.flavor === 'server' ? 'Jira rejected the token (401). Create a new personal access token in Jira and save it again.' : 'Jira rejected the email or API token (401). Create an API token at id.atlassian.com → Security → API tokens, and save it again.';
  if (status === 403) return 'Jira says you are not allowed to read that (403). The account may lack access to the project.';
  if (status === 404) return 'Jira does not know that (404). Check the base URL (Cloud looks like https://yourorg.atlassian.net) and the issue key.';
  if (status === 429) return 'Jira asks to slow down (429). Try again in a minute.';
  if (status) return `Jira answered with an error (${status}).`;
  const code = err && (err.cause && err.cause.code || err.code);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The Jira address could not be found. Check the base URL and your network.';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'Could not reach Jira (no connection or timed out).';
  return String((err && err.message) || 'Could not reach Jira.').slice(0, 200);
}

async function call(conn, token, pathAndQuery, fetchFn, { method = 'GET', body = null } = {}) {
  let res;
  try { res = await fetchFn(`${conn.baseUrl}${pathAndQuery}`, { method, headers: { Authorization: authHeader(conn, token), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) }); } catch (err) { throw new Error(explain(0, err, conn)); }
  if (!res.ok) throw new Error(explain(res.status, null, conn));
  try { return await res.json(); } catch { throw new Error('Jira answered with something that is not JSON. Is the base URL right?'); }
}

const NOT_SET_UP = 'Jira is not set up yet: give the base URL, your email and an API token.';

async function list({ cfg = {}, token, scope = 'mine', fetchFn = fetch } = {}) {
  const conn = connection(cfg);
  if (!conn || !token || (conn.flavor === 'cloud' && !conn.email)) return { error: NOT_SET_UP };
  const query = `jql=${encodeURIComponent(jql(scope, conn.project))}&fields=${FIELDS.join(',')}&maxResults=50`;
  try {
    const body = await call(conn, token, conn.api === 3 ? `/rest/api/3/search/jql?${query}` : `/rest/api/2/search?${query}`, fetchFn);
    return { items: parseList(body), project: conn.project || conn.baseUrl.replace(/^https?:\/\//, '') };
  } catch (err) { return { error: err.message }; }
}

async function show({ cfg = {}, token, key, fetchFn = fetch } = {}) {
  const conn = connection(cfg);
  if (!conn || !token || (conn.flavor === 'cloud' && !conn.email)) return { error: NOT_SET_UP };
  const k = String(key || '').trim().toUpperCase();
  if (!KEY_RE.test(k)) return { error: 'Not a Jira issue key (like PROJ-12).' };
  try {
    const body = await call(conn, token, `/rest/api/${conn.api}/issue/${encodeURIComponent(k)}?fields=${[...FIELDS, 'description'].join(',')}`, fetchFn);
    const item = parseItem(body, conn);
    return { item: { ...item, ref: item.key }, text: toTask(item) };
  } catch (err) { return { error: err.message }; }
}

/** "Check connection" in the setup form: who am I? */
async function whoami({ cfg = {}, token, fetchFn = fetch } = {}) {
  const conn = connection(cfg);
  if (!conn || !token || (conn.flavor === 'cloud' && !conn.email)) return { error: NOT_SET_UP };
  try { const me = await call(conn, token, `/rest/api/${conn.api}/myself`, fetchFn); return { name: name(me) || me.emailAddress || 'you' }; } catch (err) { return { error: err.message }; }
}

/** Adds a comment to an issue (v3 wants a document, v2 plain text). Only called when the person asked for it. */
async function comment({ cfg = {}, token, key, text, fetchFn = fetch } = {}) {
  const conn = connection(cfg);
  if (!conn || !token || (conn.flavor === 'cloud' && !conn.email)) return { error: NOT_SET_UP };
  const k = String(key || '').trim().toUpperCase();
  if (!KEY_RE.test(k)) return { error: 'Not a Jira issue key (like PROJ-12).' };
  const t = String(text || '').trim().slice(0, 8000);
  if (!t) return { error: 'Nothing to post.' };
  const body = conn.api === 3 ? { body: { type: 'doc', version: 1, content: t.split(/\n{2,}/).map((para) => ({ type: 'paragraph', content: [{ type: 'text', text: para }] })) } } : { body: t };
  try { await call(conn, token, `/rest/api/${conn.api}/issue/${encodeURIComponent(k)}/comment`, fetchFn, { method: 'POST', body }); return { ok: true }; } catch (err) { return { error: err.message }; }
}

module.exports = { comment, connection, authHeader, jql, parseList, parseItem, adfToText, toTask, explain, list, show, whoami, KEY_RE };
