'use strict';

const CODE = ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs', '*.py', '*.java', '*.go', '*.rs', '*.cs', '*.sh', '*.bash', '*.yml', '*.yaml'];

/**
 * Built-in quality gates. A check is skipped (not failed) when its tool is not installed,
 * so this list is safe to ship: you only get the gates whose tools exist on the machine.
 *
 * tier "fast": cheap enough to run on every agent edit.
 * tier "slow": compiles, tests, deep analysis; run on demand.
 * scope "files": the {files} placeholder receives the changed files that match.
 * scope "project": runs once when at least one changed file matches.
 * run may contain {files}, and for multi-module Maven builds {modules} (-pl "a,b" -am) or {modules-only} (-pl "a,b").
 * reports + reportFormat: also read a report file written by the command (junit, spotbugs, pmd, checkstyle, sarif);
 *   this is how a failing test becomes a finding at its file and line instead of "tests failed".
 */
module.exports = [
  {
    name: 'ESLint', tier: 'fast', match: ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.cjs'],
    requiresFile: ['node_modules/.bin/eslint'],
    run: 'npx --no-install eslint --format json {files}', parser: 'eslint',
  },
  {
    name: 'TypeScript', tier: 'fast', scope: 'project', match: ['*.ts', '*.tsx'],
    requiresFile: ['tsconfig.json', 'node_modules/.bin/tsc'],
    run: 'npx --no-install tsc --noEmit --pretty false', parser: 'tsc',
  },
  {
    name: 'Ruff', tier: 'fast', match: ['*.py'], requiresBin: 'ruff',
    run: 'ruff check --output-format json --no-cache {files}', parser: 'ruff',
  },
  {
    name: 'ShellCheck', tier: 'fast', match: ['*.sh', '*.bash'], requiresBin: 'shellcheck',
    run: 'shellcheck -f json {files}', parser: 'shellcheck',
  },
  {
    name: 'yamllint', tier: 'fast', match: ['*.yml', '*.yaml'], requiresBin: 'yamllint',
    run: 'yamllint -f parsable {files}', parser: 'yamllint',
  },
  {
    name: 'Pyright', tier: 'slow', match: ['*.py'], requiresBin: 'pyright',
    run: 'pyright --outputjson {files}', parser: 'pyright',
  },
  {
    name: 'Semgrep', tier: 'slow', match: CODE, requiresBin: 'semgrep',
    run: 'semgrep scan --config p/default --metrics off --sarif --quiet {files}', parser: 'sarif',
  },
  {
    // Native: no tool needed. Finds new UI components that re-implement a shared one (Button, Modal, Input...), duplicate names, raw <button>.
    name: 'Duplicate components', tier: 'fast', scope: 'project', match: ['*.jsx', '*.tsx', '*.js', '*.ts', '*.vue', '*.svelte'],
    native: 'duplicate-components', onlyChangedFiles: true,
  },
  {
    // Copy-paste detection across the whole project (npm i -g jscpd, version 5+; literals are ignored so a copied component with other text/classes still counts). Only clones that touch files/lines you changed are reported.
    name: 'Duplicate code', tier: 'slow', scope: 'project', match: ['*.js', '*.jsx', '*.ts', '*.tsx', '*.py', '*.java', '*.vue', '*.svelte', '*.kt', '*.go', '*.rs', '*.cs'],
    requiresBin: 'jscpd', onlyChangedFiles: true, timeoutSec: 300,
    run: 'jscpd . --silent --ignore-literals --min-lines 8 --min-tokens 70 --reporters json --output {tmpdir} --ignore "**/node_modules/**,**/target/**,**/dist/**,**/build/**,**/*.min.js,**/*.test.*,**/*.spec.*,**/test/**,**/tests/**,**/__tests__/**"',
    tmpReport: 'jscpd-report.json', reportFormat: 'jscpd',
  },
  {
    // Native: no tool needed. High-precision patterns (private keys, cloud/API tokens, passwords in URLs) in the changed files.
    name: 'Secrets', tier: 'fast', scope: 'project', match: ['*'], native: 'secrets',
  },
  {
    // Full rule set when gitleaks is installed (https://github.com/gitleaks/gitleaks). Only findings in changed files are reported.
    name: 'Secrets (gitleaks)', tier: 'slow', scope: 'project', match: ['*'], requiresBin: 'gitleaks', onlyChangedFiles: true, timeoutSec: 120,
    run: 'gitleaks detect --no-git --redact --no-banner --exit-code 0 --report-format sarif --report-path {tmpdir}/gitleaks.sarif',
    tmpReport: 'gitleaks.sarif', reportFormat: 'sarif',
  },
  {
    name: 'Maven compile', tier: 'slow', scope: 'project', match: ['*.java', 'pom.xml'],
    requiresFile: ['pom.xml'], requiresBin: 'mvn',
    run: 'mvn -q -B {modules} compile', parser: 'maven', timeoutSec: 600,
  },
  {
    name: 'Maven test', tier: 'slow', scope: 'project', match: ['*.java', 'pom.xml'],
    requiresFile: ['pom.xml'], requiresBin: 'mvn',
    run: 'mvn -q -B {modules} test', parser: 'maven', timeoutSec: 900,
    reports: ['**/target/surefire-reports/TEST-*.xml'], reportFormat: 'junit',
  },
  {
    name: 'pytest', tier: 'slow', scope: 'project', match: ['*.py'], requiresBin: 'pytest',
    run: 'pytest -q -x --disable-warnings --junitxml=.pytest_cache/bazinga-junit.xml', parser: 'exitcode', timeoutSec: 600,
    reports: ['.pytest_cache/bazinga-junit.xml'], reportFormat: 'junit',
  },
  {
    name: 'Vitest', tier: 'slow', scope: 'project', match: ['*.js', '*.jsx', '*.ts', '*.tsx'],
    requiresFile: ['node_modules/.bin/vitest'],
    run: 'npx --no-install vitest run', parser: 'exitcode', timeoutSec: 600,
  },
  {
    // Built into the Go toolchain, so this is always available once `go` itself is - no extra install, no version drift.
    name: 'Go vet', tier: 'fast', scope: 'project', match: ['*.go'],
    requiresFile: ['go.mod'], requiresBin: 'go',
    run: 'go vet ./...', parser: 'regex', pattern: '^(?<file>\\S+\\.go):(?<line>\\d+)(?::(?<column>\\d+))?:\\s*(?<message>.+)$',
  },
  {
    name: 'Go build', tier: 'slow', scope: 'project', match: ['*.go', 'go.mod'],
    requiresFile: ['go.mod'], requiresBin: 'go',
    run: 'go build ./...', parser: 'regex', pattern: '^(?<file>\\S+\\.go):(?<line>\\d+)(?::(?<column>\\d+))?:\\s*(?<message>.+)$', timeoutSec: 600,
  },
  {
    name: 'Go test', tier: 'slow', scope: 'project', match: ['*.go', 'go.mod'],
    requiresFile: ['go.mod'], requiresBin: 'go',
    run: 'go test ./...', parser: 'exitcode', timeoutSec: 600,
  },
  {
    name: 'Cargo check', tier: 'fast', scope: 'project', match: ['*.rs', 'Cargo.toml'],
    requiresFile: ['Cargo.toml'], requiresBin: 'cargo',
    run: 'cargo check --message-format=json', parser: 'cargo',
  },
  {
    // The `clippy` rustup component (`rustup component add clippy`) installs this as its own `cargo-clippy` binary,
    // the same way cargo itself discovers any `cargo-X` subcommand on PATH.
    name: 'Cargo clippy', tier: 'fast', scope: 'project', match: ['*.rs', 'Cargo.toml'],
    requiresFile: ['Cargo.toml'], requiresBin: 'cargo-clippy',
    run: 'cargo clippy --message-format=json', parser: 'cargo',
  },
  {
    name: 'Cargo test', tier: 'slow', scope: 'project', match: ['*.rs', 'Cargo.toml'],
    requiresFile: ['Cargo.toml'], requiresBin: 'cargo',
    run: 'cargo test', parser: 'exitcode', timeoutSec: 600,
  },
  {
    name: '.NET build', tier: 'slow', scope: 'project', match: ['*.cs', '*.csproj', '*.sln'],
    requiresBin: 'dotnet',
    run: 'dotnet build -nologo', parser: 'regex', pattern: '^(?<file>.+?)\\((?<line>\\d+),(?<column>\\d+)\\):\\s*(?<severity>error|warning)\\s+(?<rule>[A-Z]+\\d+):\\s*(?<message>.+?)(?:\\s*\\[.*\\])?$', timeoutSec: 600,
  },
  {
    name: '.NET test', tier: 'slow', scope: 'project', match: ['*.cs', '*.csproj', '*.sln'],
    requiresBin: 'dotnet',
    run: 'dotnet test --nologo', parser: 'exitcode', timeoutSec: 900,
  },
];
