'use strict';
/**
 * Scrubbed environment for agents: drop variables that look like credentials before an agent terminal starts,
 * so an agent (or a prompt-injected page it reads) cannot simply print your tokens.
 * Variables an agent button sets itself (agent.env) and names in `allow` always stay.
 */
const SECRET_NAME = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|PRIVATE_KEY|API_?KEY|ACCESS_?KEY|AUTH)(_|$)/i;
const KNOWN = /^(AWS_|AZURE_(CLIENT|TENANT)|GOOGLE_APPLICATION_CREDENTIALS|GH_|GITHUB_|GITLAB_|NPM_|NUGET_|DOCKER_|SSH_AUTH_SOCK|KUBECONFIG|VAULT_|SONAR_|OPENAI_|ANTHROPIC_|MAVEN_|ARTIFACTORY_|JFROG_)/i;
// never touched: needed for the shell and tools to work
const KEEP = /^(PATH|HOME|USER|USERNAME|SHELL|TERM|LANG|LC_.*|TMP|TEMP|TMPDIR|PWD|JAVA_HOME|GRADLE_USER_HOME|ANTHROPIC_BASE_URL|MAVEN_OPTS|MAVEN_HOME|GITHUB_WORKSPACE|GH_HOST|SYSTEMROOT|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES.*)$/i;

const isSecretName = (name) => !KEEP.test(name) && (SECRET_NAME.test(name) || KNOWN.test(name));

/**
 * @param {object} base   the environment to start from
 * @param {object} [o]    { enabled=true, allow=[] }
 * @returns {{ env: object, removed: string[] }}
 */
function scrubEnv(base, { enabled = true, allow = [] } = {}) {
  if (!enabled) return { env: { ...base }, removed: [] };
  const keep = new Set((allow || []).map((a) => String(a).toUpperCase()));
  const env = {};
  const removed = [];
  for (const [k, v] of Object.entries(base || {})) {
    if (isSecretName(k) && !keep.has(k.toUpperCase())) removed.push(k); else env[k] = v;
  }
  return { env, removed: removed.sort() };
}

module.exports = { scrubEnv, isSecretName };
