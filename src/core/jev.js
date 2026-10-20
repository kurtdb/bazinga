'use strict';
/**
 * Jev (TypeSafe AI): a decision model. It does not write text; it answers typed questions (pick one option, a score, a yes/no
 * probability) with probabilities, in 70-500 ms. Bazinga uses it where it now guesses with keywords: which KIND of task a run is.
 * Everything falls back to the keyword rules when Jev is off, unreachable, slow or unsure, so it can only improve things.
 *
 * Opt-in (`jev.enabled`, off by default). What is sent: the task text (cut at 2000 characters), nothing else; never code, diffs,
 * paths or file names. It goes to TypeSafe's API (documented as US-hosted; no EU region documented). The API key is read from an
 * environment variable (default TYPESAFE_API_KEY), never stored by Bazinga.
 *
 * Request shape (TypeSafe docs): POST /v1/systemone { state, model, questions: { name: { type: 'choice', instructions, criteria } } }.
 * The answer layout is only partly documented, so it is read defensively (see parseChoice). Not verified against the real API.
 */
const http = require('node:http');
const https = require('node:https');
const scorecard = require('./scorecard');

const DEFAULTS = { enabled: false, endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', keyEnv: 'TYPESAFE_API_KEY', minConfidence: 0.6, timeoutMs: 4000 };

const KIND_HELP = {
  tests: 'Writing or improving automated tests.',
  bugfix: 'Fixing a defect, crash, wrong behaviour or failing build.',
  refactor: 'Restructuring, renaming, migrating or cleaning up code without changing what it does.',
  feature: 'Adding new behaviour or capability.',
  docs: 'Writing or updating documentation, comments or a changelog.',
  review: 'Reading, explaining, reviewing or analysing code without changing it.',
  other: 'None of the above.',
};

function settings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.minConfidence = Math.min(1, Math.max(0, Number(s.minConfidence) || DEFAULTS.minConfidence));
  s.timeoutMs = Math.min(30000, Math.max(500, Number(s.timeoutMs) || DEFAULTS.timeoutMs));
  return s;
}

/** Only https (or http to this machine, for tests and a local gateway). */
function endpointOk(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)); } catch { return false; }
}

function kindQuestion() {
  const criteria = {};
  for (const k of scorecard.KINDS) criteria[k] = KIND_HELP[k];
  return { type: 'choice', instructions: 'What kind of software task is this request for a coding agent?', criteria };
}

function buildRequest(task, s) {
  return { state: String(task || '').slice(0, 2000), model: s.model, questions: { kind: kindQuestion() } };
}

/**
 * The chosen option and its confidence from one answer. Accepts the layouts that are plausible for a choice answer:
 * a bare string; { choice | option | value | answer | label, confidence, probabilities | probability }; or probabilities alone.
 */
function parseChoice(answer, options) {
  if (answer == null) return null;
  const pick = (v) => (typeof v === 'string' && options.includes(v) ? v : null);
  if (typeof answer === 'string') { const c = pick(answer); return c ? { choice: c, confidence: null } : null; }
  if (typeof answer !== 'object') return null;
  const probs = [answer.probabilities, answer.probability, answer.scores].find((p) => p && typeof p === 'object' && !Array.isArray(p));
  let choice = null;
  for (const k of ['choice', 'option', 'value', 'answer', 'label', 'selected']) { choice = pick(answer[k]); if (choice) break; }
  if (!choice && probs) {
    const best = Object.entries(probs).filter(([k, v]) => options.includes(k) && Number.isFinite(Number(v))).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    if (best) choice = best[0];
  }
  if (!choice) return null;
  let confidence = Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : null;
  if (confidence === null && probs && Number.isFinite(Number(probs[choice]))) confidence = Number(probs[choice]);
  return { choice, confidence };
}

function post(url, key, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const data = JSON.stringify(body);
    const req = (u.protocol === 'http:' ? http : https).request(u, { method: 'POST', timeout: timeoutMs, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${key}`, 'user-agent': 'bazinga' } }, (res) => {
      const parts = []; res.on('data', (c) => { if (parts.length < 200) parts.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error(`Jev answered HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Jev answered something that is not JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Jev took too long')));
    req.on('error', reject);
    req.end(data);
  });
}

const cache = new Map();
/**
 * The kind of a task: Jev when it is on, reachable and sure enough, the keyword rules otherwise.
 * @returns {Promise<{kind: string, source: 'jev'|'rules', confidence?: number|null, note?: string}>}
 */
async function kindOf(task, raw, { env = process.env, request = post, key: storedKey = '' } = {}) {
  const fallback = (note) => ({ kind: scorecard.kindOf(task), source: 'rules', ...(note ? { note } : {}) });
  const s = settings(raw);
  if (!s.enabled) return fallback();
  const text = String(task || '').trim();
  if (text.length < 8) return fallback();
  const key = storedKey || env[s.keyEnv]; // the key pasted into Bazinga wins over the environment variable
  if (!key) return fallback('no key yet');
  if (!endpointOk(s.endpoint)) return fallback('the Jev endpoint must be https');
  const ck = `${s.model}\u0000${text.slice(0, 2000)}`;
  if (cache.has(ck)) return cache.get(ck);
  try {
    const res = await request(s.endpoint, key, buildRequest(text, s), s.timeoutMs);
    const got = parseChoice(res && res.kind !== undefined ? res.kind : (res && res.answers && res.answers.kind), scorecard.KINDS);
    if (!got) return fallback('Jev answered in a layout Bazinga does not know');
    if (got.confidence !== null && got.confidence < s.minConfidence) return fallback(`Jev was not sure (${Math.round(got.confidence * 100)}%)`);
    const out = { kind: got.choice, source: 'jev', confidence: got.confidence };
    cache.set(ck, out); if (cache.size > 200) cache.delete(cache.keys().next().value);
    return out;
  } catch (err) { return fallback(String(err.message || err).split(key).join('***').slice(0, 120)); } // the key never ends up in a message or a log
}

module.exports = { DEFAULTS, KIND_HELP, settings, endpointOk, buildRequest, parseChoice, kindOf, _cache: cache };
