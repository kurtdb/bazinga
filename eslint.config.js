'use strict';
/**
 * Flat config (ESLint 9+). Plain CommonJS throughout (no bundler, no TS - see AGENTS.md), so every file gets
 * the same parser options; only the globals differ between a Node process (main/core/bin/scripts/test) and the
 * renderer, which runs as a plain <script> in the Electron window, not a Node module.
 */
const NODE_GLOBALS = {
  require: 'readonly', module: 'readonly', exports: 'writable', process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  console: 'readonly', Buffer: 'readonly', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  fetch: 'readonly', Response: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly', performance: 'readonly', crypto: 'readonly',
  self: 'readonly', // the `typeof self !== 'undefined' ? self : this` UMD idiom some core modules use to load as either a Node module or a plain <script>
};
const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly', WheelEvent: 'readonly',
  getComputedStyle: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', btoa: 'readonly', atob: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  history: 'readonly', location: 'readonly', matchMedia: 'readonly', Node: 'readonly', getSelection: 'readonly',
  FileReader: 'readonly', Blob: 'readonly', FormData: 'readonly', WebSocket: 'readonly', Worker: 'readonly', Image: 'readonly', Intl: 'readonly',
  // globals one renderer script attaches for another plain <script> to read (no bundler, so no import/export between them)
  BazingaBestOf: 'readonly', BazingaBoard: 'readonly', monaco: 'readonly', Terminal: 'readonly', FitAddon: 'readonly', SearchAddon: 'readonly', WebLinksAddon: 'readonly',
};
const RULES = {
  // ignoreRestSiblings: the `const { drop, ...rest } = x` idiom (excluding a field by destructuring it out) is
  // everywhere in this codebase; argsIgnorePattern: the existing `_e` convention for an intentionally-unused
  // IPC callback argument (event objects that are never read).
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
  'no-undef': 'warn',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-fallthrough': 'warn',
  'no-constant-condition': 'warn',
  'no-empty': 'warn',
  'no-unreachable': 'warn',
  'no-case-declarations': 'warn',
  'no-redeclare': 'warn',
  'no-self-assign': 'warn',
  'no-cond-assign': 'warn',
  'no-control-regex': 'warn',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'vendor/**', '*.worktrees/**'] },
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: NODE_GLOBALS }, rules: RULES },
  { files: ['src/renderer/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } }, rules: RULES },
  // An unconsumed fetch() response body leaks a file descriptor until the process freezes (crbug 378822137,
  // see src/core/safeFetch.js) - every call in shipped source goes through safeFetch() instead, which is the
  // one place allowed to call fetch() itself. Scoped to src/ (not test/): tests hit short-lived local servers
  // they tear down themselves, so the leak this guards against cannot accumulate there.
  {
    files: ['src/**/*.js'],
    ignores: ['src/core/safeFetch.js'],
    rules: { 'no-restricted-syntax': ['error', { selector: "CallExpression[callee.name='fetch']", message: 'Call safeFetch() (src/core/safeFetch.js) instead of bare fetch() - an unconsumed response body leaks a file descriptor (crbug 378822137).' }] },
  },
];
