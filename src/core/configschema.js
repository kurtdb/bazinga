'use strict';
/**
 * Checks .ide/config.json (and the IDE-level settings) against a schema (ajv) and says what is wrong in plain words:
 * wrong type, a value that is not allowed, and keys that look like a typo of a real one. Unknown keys are allowed (other tools
 * and newer versions add their own); nothing here ever blocks loading, it only reports.
 */
const Ajv = require('ajv');

const str = { type: 'string' };
const bool = { type: 'boolean' };
const num = { type: 'number' };
const strList = { type: 'array', items: str };
const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  properties: {
    shell: nullable(str), shellArgs: nullable(strList),
    theme: { enum: ['system', 'light', 'dark', 'high-contrast', 'high-contrast-light', 'night', 'nerd', 'tron', 'wargames'] },
    autoCheck: bool, autoCheckpoint: bool, agentHooks: bool, notifications: bool,
    agents: { type: 'array', items: { type: 'object', required: ['name', 'command'], properties: { name: str, command: str, taskCommand: str, protocol: { enum: ['pty', 'acp'] }, api: { enum: ['anthropic', 'openai'] }, context: { type: 'number', minimum: 0 }, policy: { enum: ['ask', 'allow', 'reject'] }, hint: str, env: { type: 'object', additionalProperties: str } } } },
    fixLoop: { type: 'object', properties: { enabled: bool, maxRounds: { type: 'integer', minimum: 1, maximum: 20 }, idleSeconds: { type: 'number', minimum: 1 }, tier: str, include: str, relatedTests: bool, testTimeoutSec: { type: 'number', minimum: 1 }, escalate: { type: 'object', properties: { agent: str, after: { type: 'integer', minimum: 1, maximum: 10 } } } } },
    autoMerge: { type: 'object', properties: { enabled: bool, minWinRate: { type: 'number', minimum: 0, maximum: 1 }, dryRun: bool } },
    oversight: nullable({ enum: ['autonomous', 'supervised', 'guided', 'stepwise'] }),
    taskPrefix: str, notifyKinds: nullable(strList),
    mergeGuard: { type: 'object', additionalProperties: { enum: ['block', 'warn', 'off'] } },
    agentContainer: { type: 'object', properties: { enabled: bool } },
    agentEnv: { type: 'object', properties: { scrub: bool, allow: strList } },
    ollama: { type: 'object', properties: { baseUrl: str, keepWarm: bool, keepAlive: str, unloadOthers: bool, noThink: bool, proxy: bool, restrictTools: bool, repair: bool, lean: bool, testMinutes: { type: 'number', minimum: 0 } } },
    skillsMirrors: strList, skillsIndex: bool, skillsDir: str,
    folders: { type: 'object', properties: { source: strList, tests: strList } },
    foldersFiles: { type: 'integer', minimum: 0 }, foldersIndex: bool,
    reviewRules: str, runBudgetMinutes: { type: 'number', minimum: 0 },
    protectedPaths: nullable(strList),
    symbolLenses: { type: 'object', properties: { usages: bool, blame: bool, spring: bool } },
    workItems: { type: 'object', properties: { jiraBaseUrl: str, orgUrl: str, project: str } },
    jira: { type: 'object', properties: { baseUrl: str, email: str, project: str, flavor: { enum: ['cloud', 'server'] } } },
    fleet: { type: 'object', properties: { staleMinutes: { type: 'number', minimum: 1, maximum: 120 }, prices: { type: 'object', additionalProperties: { type: 'array', items: num, minItems: 2, maxItems: 2 } } } },
    editorFontSize: { type: 'number', minimum: 8, maximum: 40 }, terminalFontSize: { type: 'number', minimum: 8, maximum: 40 },
    terminalScrollback: { type: 'integer', minimum: 200, maximum: 50000 },
    lsp: { type: 'object', properties: { enabled: bool, servers: { type: 'object' } } },
    runLinkDirs: strList, reviewCommand: str,
    symbolParser: { enum: ['auto', 'regex'] },
    updates: { type: 'object', properties: { check: bool, channel: { enum: ['latest', 'beta'] } } },
    telemetry: { type: 'object', properties: { otel: bool } },
    mcp: { type: 'object', properties: { server: bool } },
    insights: { type: 'object', properties: { claudeLimits: bool, sonarProject: str, actuatorUrl: str } },
    containerWhenUnattended: { enum: ['auto', 'off'] },
    externalEditor: { enum: ['auto', 'vscode', 'idea'] },
    copilot: { type: 'object', properties: { enabled: bool } },
    jev: { type: 'object', properties: { enabled: bool, endpoint: str, model: str, keyEnv: str, minConfidence: { type: 'number', minimum: 0, maximum: 1 }, timeoutMs: { type: 'number', minimum: 500, maximum: 30000 } } },
    acp: { type: 'object', properties: { agents: { type: 'object' } } },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn = ajv.compile(SCHEMA);
const KNOWN = Object.keys(SCHEMA.properties);

function distance(a, b) { // Levenshtein, small strings only
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const suggest = (key) => KNOWN.find((k) => k.toLowerCase() === key.toLowerCase() || (key.length > 3 && distance(k.toLowerCase(), key.toLowerCase()) <= 2));

const where = (p) => (p ? p.replace(/^\//, '').replace(/\//g, '.').replace(/\.(\d+)(?=\.|$)/g, '[$1]') : 'the file');

function sentence(e) {
  const at = where(e.instancePath);
  switch (e.keyword) {
    case 'type': return `${at} must be ${e.params.type === 'integer' ? 'a whole number' : /^[aeiou]/.test(e.params.type) ? `an ${e.params.type}` : `a ${e.params.type}`}`;
    case 'enum': return `${at} must be one of: ${e.params.allowedValues.join(', ')}`;
    case 'required': return `${at === 'the file' ? 'an entry' : at} is missing “${e.params.missingProperty}”`;
    case 'minimum': return `${at} must be at least ${e.params.limit}`;
    case 'maximum': return `${at} must be at most ${e.params.limit}`;
    case 'minItems': case 'maxItems': return `${at} must have exactly ${e.params.limit} numbers (input price, output price)`;
    default: return null; // anyOf noise: the specific errors say it better
  }
}

/** @returns {string[]} one plain sentence per problem (empty = fine) */
function problems(cfg) {
  if (cfg === null || cfg === undefined) return [];
  if (typeof cfg !== 'object' || Array.isArray(cfg)) return ['the file must contain a JSON object ({ … })'];
  const out = [];
  validateFn(cfg);
  const seen = new Set();
  const errors = validateFn.errors || [];
  // a nullable setting with the wrong kind of value fails every branch of its anyOf: say it once
  const anyOfAt = new Set(errors.filter((e) => e.keyword === 'anyOf').map((e) => e.instancePath));
  for (const e of errors) {
    const inAnyOf = e.schemaPath.includes('/anyOf/') && anyOfAt.has(e.instancePath);
    const t = e.keyword === 'anyOf' ? `${where(e.instancePath)} has the wrong kind of value` : inAnyOf ? null : sentence(e);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  for (const k of Object.keys(cfg)) {
    if (KNOWN.includes(k) || ['taskTemplates'].includes(k)) continue;
    const s = suggest(k);
    if (s) out.push(`“${k}” is not a setting; did you mean “${s}”?`);
  }
  return out;
}

module.exports = { problems, SCHEMA, KNOWN };
