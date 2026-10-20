'use strict';
/**
 * Pure checks behind the extra merge-guard rules: protected paths, "a bugfix needs a regression test",
 * and dependency changes.  No IO: callers pass the changed files ({path,status}) of the run.
 */
const { toPosix, globToRegExp } = require('./util');
const { isTestPath } = require('./scope');

const DEFAULT_PROTECTED = [
  '.env', '.env.*', '**/.env', '**/.env.*',
  '.github/workflows/**', '.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml',
  '**/secrets/**', '*.pem', '*.key', '**/*.pem', '**/*.key',
  'Dockerfile', '**/Dockerfile',
  '.ide/policy.json', // the shared guard policy itself
];

const compile = (glob) => {
  const g = toPosix(String(glob || '')).replace(/^\.\//, '');
  const re = globToRegExp(g);
  // a pattern without a slash matches the basename anywhere (gitignore-style)
  return g.includes('/') ? (p) => re.test(p) : (p) => re.test(p.slice(p.lastIndexOf('/') + 1));
};

/** Files whose path matches any protected glob. */
function protectedHits(files, globs) {
  const list = (Array.isArray(globs) ? globs : DEFAULT_PROTECTED).filter((g) => typeof g === 'string' && g.trim());
  const tests = list.map(compile);
  return [...new Set((files || []).map((f) => toPosix(f.path || f)).filter((p) => tests.some((t) => t(p))))];
}

const BUGFIX_RE = /\b(fix(es|ed)?|bug(fix)?|regression|hotfix|defect|crash(es)?|broken|npe|nullpointer(exception)?|wrong|incorrect|fails?|failing|issue)\b/i;

/** Does the task text or branch name describe a bug fix? */
const looksLikeBugfix = (...texts) => texts.some((t) => BUGFIX_RE.test(String(t || '').replace(/[-_/]+/g, ' ')));

/**
 * A bugfix should add or touch a test.  Returns true when the run looks like a bugfix, changed
 * non-test source, and no test file was added or modified.
 */
function bugfixWithoutTest({ task, branch, files }) {
  if (!looksLikeBugfix(task, branch)) return false;
  const live = (files || []).filter((f) => f.status !== 'D');
  const source = live.filter((f) => !isTestPath(f.path) && /\.(java|kt|js|jsx|ts|tsx|py|go|rs|cs|rb|php|scala|c|cc|cpp|h)$/i.test(f.path));
  if (!source.length) return false;
  return !live.some((f) => isTestPath(f.path));
}

const DEP_FILES = [
  /(^|\/)package\.json$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)pom\.xml$/, /(^|\/)build\.gradle(\.kts)?$/, /(^|\/)settings\.gradle(\.kts)?$/, /(^|\/)gradle\/libs\.versions\.toml$/,
  /(^|\/)requirements[^/]*\.txt$/, /(^|\/)pyproject\.toml$/, /(^|\/)Pipfile(\.lock)?$/, /(^|\/)poetry\.lock$/,
  /(^|\/)go\.(mod|sum)$/, /(^|\/)Cargo\.(toml|lock)$/, /(^|\/)Gemfile(\.lock)?$/, /(^|\/)composer\.(json|lock)$/,
  /\.csproj$/, /(^|\/)packages\.config$/, /(^|\/)NuGet\.config$/,
];

/** Changed files that are dependency manifests or lockfiles. */
const dependencyFiles = (files) =>
  [...new Set((files || []).map((f) => toPosix(f.path || f)).filter((p) => DEP_FILES.some((re) => re.test(p))))];

/** Existing unit/integration tests that were modified, renamed or deleted (new test files are fine). */
const modifiedTests = (files) =>
  [...new Set((files || []).filter((f) => isTestPath(f.path) && f.status && !['A', '?', '??'].includes(f.status)).map((f) => toPosix(f.path)))];

module.exports = { modifiedTests, DEFAULT_PROTECTED, protectedHits, looksLikeBugfix, bugfixWithoutTest, dependencyFiles };
