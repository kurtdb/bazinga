'use strict';
/**
 * Put the guard's result on the pull request as a comment (Azure DevOps or GitHub). One comment per pull request: a second run
 * updates it instead of adding another. Needs a token the pipeline already has (System.AccessToken / GITHUB_TOKEN); without one
 * nothing is posted and the reason is returned, so a missing token never fails the build.
 */
const https = require('node:https');
const http = require('node:http');

const MARK = '<!-- bazinga-guard -->';

/** Markdown for the comment. */
function markdown(res) {
  const g = res.guard;
  const head = g.clean ? '### ✅ Bazinga guard: clean' : `### ${g.blockers ? '⛔' : '⚠️'} Bazinga guard: ${g.blockers} blocker(s), ${g.warnings} warning(s)`;
  const rows = g.items.map((it) => {
    const files = it.files && it.files.length ? ` — \`${it.files.slice(0, 6).join('`, `')}\`${it.files.length > 6 ? ' …' : ''}` : '';
    return `- ${it.level === 'block' ? '**BLOCK**' : 'warn'} \`${it.id}\` ${it.text}${files}`;
  });
  return [MARK, head, '', ...rows, '', `<sub>${res.files.length} changed file(s) compared with ${res.base}.</sub>`].join('\n');
}

/** Where the pull request is, from the pipeline's variables. Returns null outside a pipeline. */
function detect(env = process.env) {
  if (env.SYSTEM_PULLREQUEST_PULLREQUESTID && env.SYSTEM_COLLECTIONURI && env.SYSTEM_TEAMPROJECT) {
    const repo = env.BUILD_REPOSITORY_ID || env.BUILD_REPOSITORY_NAME;
    if (!repo) return null;
    return { kind: 'azure', base: `${env.SYSTEM_COLLECTIONURI.replace(/\/?$/, '/')}${encodeURIComponent(env.SYSTEM_TEAMPROJECT)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullRequests/${env.SYSTEM_PULLREQUEST_PULLREQUESTID}`, token: env.SYSTEM_ACCESSTOKEN || '' };
  }
  const m = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF || '');
  if (m && env.GITHUB_REPOSITORY) {
    return { kind: 'github', base: `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/issues/${m[1]}`, token: env.GITHUB_TOKEN || '' };
  }
  return null;
}

function realRequest(method, url, token, kind, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { accept: 'application/json', 'user-agent': 'bazinga-guard', authorization: kind === 'azure' ? `Bearer ${token}` : `Bearer ${token}` };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const req = (u.protocol === 'http:' ? http : https).request(u, { method, headers, timeout: 20000 }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} from ${u.host}${json && json.message ? `: ${json.message}` : ''}`));
        else resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * @returns {Promise<{posted: boolean, updated?: boolean, reason?: string}>}
 * @param {object} res  ciguard.evaluateBranch() result
 * @param {{env?: object, request?: Function}} o  `request(method, url, token, kind, body)` is replaceable for tests
 */
async function post(res, { env = process.env, request = realRequest } = {}) {
  const where = detect(env);
  if (!where) return { posted: false, reason: 'Not running in a pull request pipeline.' };
  if (!where.token) return { posted: false, reason: where.kind === 'azure' ? 'No token: map the secret with  env: { SYSTEM_ACCESSTOKEN: $(System.AccessToken) }  and give the build service "Contribute to pull requests".' : 'No GITHUB_TOKEN in the environment (needs permissions: pull-requests: write).' };
  const text = markdown(res);
  try {
    if (where.kind === 'github') {
      const list = (await request('GET', `${where.base}/comments?per_page=100`, where.token, 'github')) || [];
      const mine = list.find((c) => c && typeof c.body === 'string' && c.body.includes(MARK));
      if (mine) { await request('PATCH', `${where.base.replace(/\/issues\/\d+$/, '')}/issues/comments/${mine.id}`, where.token, 'github', { body: text }); return { posted: true, updated: true }; }
      await request('POST', `${where.base}/comments`, where.token, 'github', { body: text });
      return { posted: true, updated: false };
    }
    const threads = ((await request('GET', `${where.base}/threads?api-version=7.1`, where.token, 'azure')) || {}).value || [];
    for (const t of threads) {
      const c = (t.comments || []).find((x) => x && typeof x.content === 'string' && x.content.includes(MARK));
      if (c) {
        await request('PATCH', `${where.base}/threads/${t.id}/comments/${c.id}?api-version=7.1`, where.token, 'azure', { content: text });
        await request('PATCH', `${where.base}/threads/${t.id}?api-version=7.1`, where.token, 'azure', { status: res.guard.clean ? 'closed' : 'active' });
        return { posted: true, updated: true };
      }
    }
    await request('POST', `${where.base}/threads?api-version=7.1`, where.token, 'azure', { comments: [{ parentCommentId: 0, content: text, commentType: 1 }], status: res.guard.clean ? 'closed' : 'active' });
    return { posted: true, updated: false };
  } catch (err) {
    return { posted: false, reason: `Could not post the comment: ${err.message}` };
  }
}

module.exports = { MARK, markdown, detect, post };
