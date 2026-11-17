'use strict';

(async function main() {
  const api = window.api;
  const $ = (sel, root = document) => root.querySelector(sel);
  const norm = (s) => String(s).replace(/\r\n/g, '\n');
  const IS_MAC = api.platform === 'darwin';
  const MOD = IS_MAC ? 'Cmd' : 'Ctrl';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** replaceChildren() turns a null/undefined/false argument into the text "null": drop those first. */
  function fill(host, ...nodes) {
    host.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  }

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  }

  // ---------------------------------------------------------------- state
  if (IS_MAC) {
    const swap = (t) => t.replace(/Ctrl\+Shift\+/g, '⌘⇧').replace(/Ctrl\+(?!`)/g, '⌘');
    for (const n of document.querySelectorAll('[title],[placeholder]')) {
      for (const a of ['title', 'placeholder']) if (n.hasAttribute(a)) n.setAttribute(a, swap(n.getAttribute(a)));
    }
    for (const b of document.querySelectorAll('#welcome b')) b.textContent = swap(b.textContent);
  }

  // ---------------------------------------------------------------- theme (system / light / dark / high-contrast / night / nerd) and fonts
  // Alternative coding fonts (Settings -> General -> Font), all bundled via @fontsource and OFL-1.1 licensed, same
  // as Roboto Mono itself. `family` is the full CSS font-family fallback chain, consumed by Monaco, xterm and
  // every other --font-mono use in styles.css (set at runtime by applyFonts() below).
  const MONO_FONTS = {
    'roboto-mono': { label: 'Roboto Mono (default)', family: "'Roboto Mono', 'Cascadia Code', Consolas, Menlo, monospace" },
    'jetbrains-mono': { label: 'JetBrains Mono', family: "'JetBrains Mono', 'Cascadia Code', Consolas, Menlo, monospace" },
    'fira-code': { label: 'Fira Code', family: "'Fira Code', 'Cascadia Code', Consolas, Menlo, monospace" },
    'cascadia-code': { label: 'Cascadia Code', family: "'Cascadia Code', Consolas, Menlo, monospace" },
    'source-code-pro': { label: 'Source Code Pro', family: "'Source Code Pro', 'Cascadia Code', Consolas, Menlo, monospace" },
    'ibm-plex-mono': { label: 'IBM Plex Mono', family: "'IBM Plex Mono', 'Cascadia Code', Consolas, Menlo, monospace" },
  };
  const monoFontId = () => { const v = state.project && state.project.config && state.project.config.monoFont; return MONO_FONTS[v] ? v : 'roboto-mono'; };
  let MONO = MONO_FONTS['roboto-mono'].family;
  const TERM_THEMES = {
    dark: { background: '#14161a', foreground: '#d7dae0', cursor: '#d7dae0', selectionBackground: '#33466b' },
    light: {
      background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', cursorAccent: '#ffffff', selectionBackground: '#b6d4fe',
      black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#7d4e00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#116329', brightYellow: '#633c01', brightBlue: '#0550ae', brightMagenta: '#6639ba', brightCyan: '#3192aa', brightWhite: '#8c959f',
    },
    'high-contrast': {
      background: '#000000', foreground: '#ffffff', cursor: '#ffffff', cursorAccent: '#000000', selectionBackground: '#003a5c',
      black: '#000000', red: '#ff6b6b', green: '#5ee079', yellow: '#ffd43b', blue: '#5ec2ff', magenta: '#ff8cff', cyan: '#4dffe8', white: '#ffffff',
      brightBlack: '#6e6e6e', brightRed: '#ff9b9b', brightGreen: '#9bffb0', brightYellow: '#ffe48c', brightBlue: '#9bdaff', brightMagenta: '#ffc2ff', brightCyan: '#9bfff2', brightWhite: '#ffffff',
    },
    'high-contrast-light': {
      background: '#ffffff', foreground: '#000000', cursor: '#000000', cursorAccent: '#ffffff', selectionBackground: '#cfe0ff',
      black: '#000000', red: '#b30000', green: '#006400', yellow: '#6b4b00', blue: '#0046ab', magenta: '#6a0dad', cyan: '#006666', white: '#3a3a3a',
      brightBlack: '#595959', brightRed: '#d60000', brightGreen: '#008000', brightYellow: '#8a6300', brightBlue: '#0058d6', brightMagenta: '#8a12d6', brightCyan: '#008080', brightWhite: '#000000',
    },
    night: {
      background: '#1a130d', foreground: '#ecd9bb', cursor: '#ecd9bb', cursorAccent: '#1a130d', selectionBackground: '#4a331a',
      black: '#1a130d', red: '#e8714f', green: '#b7b24a', yellow: '#dcb04a', blue: '#e8a259', magenta: '#c98a6e', cyan: '#a68a4a', white: '#ecd9bb',
      brightBlack: '#8a7256', brightRed: '#f0987a', brightGreen: '#cfca7a', brightYellow: '#e8c57a', brightBlue: '#edb97e', brightMagenta: '#d8a68f', brightCyan: '#c2a96f', brightWhite: '#f5ead6',
    },
    nerd: {
      background: '#000000', foreground: '#39ff6a', cursor: '#39ff6a', cursorAccent: '#000000', selectionBackground: '#0a3d35',
      black: '#000000', red: '#ff4d4d', green: '#39ff6a', yellow: '#f0ff4d', blue: '#39d4ff', magenta: '#a0ff39', cyan: '#39ffe0', white: '#9be8ad',
      brightBlack: '#1f7a3a', brightRed: '#ff8c8c', brightGreen: '#9bffb5', brightYellow: '#f7ff9b', brightBlue: '#9be8ff', brightMagenta: '#c9ff9b', brightCyan: '#9bfff2', brightWhite: '#e2ffe8',
    },
    tron: {
      background: '#000000', foreground: '#7df9ff', cursor: '#00e5ff', cursorAccent: '#000000', selectionBackground: '#063a4a',
      black: '#000000', red: '#ff2d55', green: '#00ffc3', yellow: '#ffaa00', blue: '#00b8d9', magenta: '#ff6ec7', cyan: '#00e5ff', white: '#9fe8f5',
      brightBlack: '#2d5c6b', brightRed: '#ff7a95', brightGreen: '#7affdf', brightYellow: '#ffd27a', brightBlue: '#4fc3f7', brightMagenta: '#ffa3dd', brightCyan: '#aef5ff', brightWhite: '#e8fbff',
    },
    wargames: {
      background: '#000000', foreground: '#ffb000', cursor: '#ffcc33', cursorAccent: '#000000', selectionBackground: '#4d3a0a',
      black: '#000000', red: '#ff3333', green: '#39d353', yellow: '#ff8800', blue: '#5ec2ff', magenta: '#b8860b', cyan: '#ffcc33', white: '#e8c07a',
      brightBlack: '#7a5c14', brightRed: '#ff7a7a', brightGreen: '#8ef09e', brightYellow: '#ffb84d', brightBlue: '#9bdaff', brightMagenta: '#d9ac4f', brightCyan: '#ffdb7a', brightWhite: '#fff0cc',
    },
  };
  const MONACO_THEMES = { light: 'vs', dark: 'vs-dark', 'high-contrast': 'bazinga-hc', 'high-contrast-light': 'bazinga-hc-light', night: 'bazinga-night', nerd: 'bazinga-nerd', tron: 'bazinga-tron', wargames: 'bazinga-wargames' };
  const GUARD_LABELS = { errors: 'Gate errors in the changes', tests: 'Tests deleted or weakened', scope: 'Files outside the task scope', unreviewed: 'Files not marked reviewed', summary: 'Files missing from the agent’s summary', gatesNotRun: 'Gates could not be run', protectedPaths: 'Protected files changed (.env, CI workflows, keys…)', bugfixTest: 'Bugfix without a new or changed test', dependencies: 'Dependency files changed', testsImmutable: 'Existing unit/integration tests modified (immutable tests)' };
  // same ids/labels as core/scorecard.js's KINDS/LABELS - kept as a literal here, same as GUARD_LABELS above, since
  // the renderer never requires core modules directly.
  const KIND_LABELS = { tests: 'Tests', bugfix: 'Bug fix', refactor: 'Refactor', feature: 'New feature', docs: 'Docs', review: 'Review / explain', other: 'Other' };
  // mirrors core/keybindings.js's DEFAULT_KEYBINDINGS/normalizeChord/resolve/findConflicts - kept as a literal
  // here, same as GUARD_LABELS/KIND_LABELS above, since the renderer never requires core modules directly.
  // core/keybindings.test.js is the source of truth for this logic; keep the two in sync by hand.
  const DEFAULT_KEYBINDINGS = [
    { id: 'goToFile', title: 'Go to file…', chord: 'Mod+P' },
    { id: 'goToSymbol', title: 'Go to symbol in workspace…', chord: 'Mod+T' },
    { id: 'commandPalette', title: 'Command palette…', chord: 'Mod+Shift+P' },
    { id: 'focusSearch', title: 'Show: Search in project', chord: 'Mod+Shift+F' },
    { id: 'saveFile', title: 'Save file', chord: 'Mod+S' },
    { id: 'newTerminal', title: 'New terminal', chord: 'Ctrl+`' },
  ];
  const KEYBIND_MOD_ORDER = ['Mod', 'Ctrl', 'Shift', 'Alt'];
  function normalizeChord(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const mods = new Set(); let key = null;
    for (const part of raw.split('+').map((p) => p.trim()).filter(Boolean)) {
      const mod = KEYBIND_MOD_ORDER.find((m) => m.toLowerCase() === part.toLowerCase());
      if (mod) mods.add(mod); else key = part.length === 1 ? part.toUpperCase() : part;
    }
    return key ? [...KEYBIND_MOD_ORDER.filter((m) => mods.has(m)), key].join('+') : null;
  }
  function resolveKeybindings(overrides) {
    const known = new Set(DEFAULT_KEYBINDINGS.map((k) => k.id));
    const out = {};
    for (const { id, chord } of DEFAULT_KEYBINDINGS) out[id] = normalizeChord(chord);
    for (const [id, chord] of Object.entries(overrides || {})) if (known.has(id)) out[id] = chord === null ? null : normalizeChord(chord);
    return out;
  }
  function findKeybindingConflicts(resolved) {
    const byChord = new Map();
    for (const [id, chord] of Object.entries(resolved)) {
      if (!chord) continue;
      if (!byChord.has(chord)) byChord.set(chord, []);
      byChord.get(chord).push(id);
    }
    return [...byChord.entries()].filter(([, ids]) => ids.length > 1).map(([chord, ids]) => ({ chord, ids }));
  }
  /** Builds the same chord string normalizeChord() produces, from a live KeyboardEvent. */
  function chordFromEvent(e) {
    const mods = [];
    if (IS_MAC ? e.metaKey : e.ctrlKey) mods.push('Mod');
    if (IS_MAC && e.ctrlKey) mods.push('Ctrl'); // on mac, literal Ctrl is distinct from Cmd/Mod
    if (e.shiftKey) mods.push('Shift');
    if (e.altKey) mods.push('Alt');
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null; // a bare modifier is not a chord
    return [...mods, key].join('+');
  }
  const resolvedKeymap = () => resolveKeybindings((state.project && state.project.config && state.project.config.keybindings) || {});
  /** command id -> display chord, for the hint shown in the command palette and the Keyboard settings tab. */
  const chordLabel = (chord) => (chord || '').replace('Mod', MOD);
  const THEME_META = {
    system: { label: 'System', icon: 'settings' },
    light: { label: 'Light', icon: 'sun' },
    dark: { label: 'Dark', icon: 'moon' },
    'high-contrast': { label: 'High contrast, dark (low vision)', icon: 'eye' },
    'high-contrast-light': { label: 'High contrast, light (low vision)', icon: 'eye' },
    night: { label: 'Night (late work, low blue light)', icon: 'moon' },
    nerd: { label: 'Nerd (phosphor terminal)', icon: 'terminal' },
    tron: { label: 'Tron (the Grid)', icon: 'cpu' },
    wargames: { label: 'WarGames (WOPR terminal)', icon: 'play-circle' },
  };
  // the toolbar button is a quick light/dark toggle, not the full picker (that lives in Settings -> General -> Theme):
  // a theme with a light/dark sibling (the base pair, high-contrast) flips to it; one without (night, nerd, tron,
  // wargames - all deliberately dark-only by design, see styles.css) falls back to plain light, same as a first
  // click away from system.
  const THEME_TOGGLE = {
    system: () => (darkQuery.matches ? 'light' : 'dark'),
    light: 'dark', dark: 'light',
    'high-contrast': 'high-contrast-light', 'high-contrast-light': 'high-contrast',
    night: 'light', nerd: 'light', tron: 'light', wargames: 'light',
  };
  let themeSetting = 'system';
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const resolvedTheme = () => (themeSetting === 'system' ? (darkQuery.matches ? 'dark' : 'light') : themeSetting);

  // ---- custom themes (Settings -> General -> "Create custom theme…"): built from 3 seed colours via
  // api.theme.derive (src/core/custompalette.js), stored in settings.customThemes. Unlike the built-in
  // themes above, they have no :root[data-theme="x"] CSS block, so their ~27 variables are set as inline
  // styles on <html> instead - which is why applyTheme() always clears them first (inline style beats the
  // attribute-selector CSS, so a stale override would otherwise leak into the next built-in theme picked).
  const CUSTOM_VAR_KEYS = ['--bg', '--bg-2', '--bg-3', '--line', '--fg', '--muted', '--faint', '--accent', '--err', '--warn', '--info', '--ok',
    '--accent-bg', '--accent-line', '--danger-line', '--err-bg', '--warn-bg', '--ok-bg', '--info-bg', '--g0', '--g1', '--g2', '--g3', '--g4', '--g5', '--overlay', '--shadow'];
  const isCustomId = (id) => typeof id === 'string' && id.startsWith('custom-');
  const findCustomTheme = (id) => state.customThemes.find((c) => c.id === id);
  function applyCustomVars(vars) {
    const s = document.documentElement.style;
    if (!vars) { for (const k of CUSTOM_VAR_KEYS) s.removeProperty(k); return; }
    for (const k of CUSTOM_VAR_KEYS) if (vars[k]) s.setProperty(k, vars[k]);
  }
  const mixHex = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [ar, ag, ab] = p(a); const [br, bg, bb] = p(b);
    const h2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
    return `#${h2(ar + (br - ar) * t)}${h2(ag + (bg - ag) * t)}${h2(ab + (bb - ab) * t)}`;
  };
  function buildTermTheme(vars) {
    const lighten = (hex) => mixHex(hex, '#ffffff', 0.3);
    return {
      background: vars['--bg'], foreground: vars['--fg'], cursor: vars['--fg'], cursorAccent: vars['--bg'], selectionBackground: vars['--accent-bg'],
      black: vars['--bg'], red: vars['--err'], green: vars['--ok'], yellow: vars['--warn'], blue: vars['--accent'], magenta: vars['--g3'], cyan: vars['--info'], white: vars['--fg'],
      brightBlack: vars['--faint'], brightRed: lighten(vars['--err']), brightGreen: lighten(vars['--ok']), brightYellow: lighten(vars['--warn']),
      brightBlue: lighten(vars['--accent']), brightMagenta: lighten(vars['--g3']), brightCyan: lighten(vars['--info']), brightWhite: '#ffffff',
    };
  }
  /** Monaco happily redefines a theme id in place, which is what every call here relies on: an edited-and-resaved
   * custom theme keeps the same id, and the live preview below reuses one id on every keystroke - so this is
   * never cached, unlike the built-ins' one-time defineTheme calls in initEditors(). */
  function ensureMonacoCustomTheme(id, vars) {
    const name = `bazinga-custom-${id}`;
    if (!window.monaco) return name;
    monaco.editor.defineTheme(name, { base: vars['--bg'] === '#ffffff' || vars['--bg'] === '#fff' ? 'vs' : 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': vars['--bg'], 'editor.foreground': vars['--fg'], 'editor.lineHighlightBackground': vars['--bg-3'],
      'editorCursor.foreground': vars['--fg'], 'editor.selectionBackground': vars['--accent-bg'],
      'editorLineNumber.foreground': vars['--faint'], 'editorLineNumber.activeForeground': vars['--fg'],
    } });
    return name;
  }
  const themeLabel = (id) => (THEME_META[id] ? THEME_META[id].label : (findCustomTheme(id) || {}).label || id);
  const themeIcon = (id) => (THEME_META[id] ? THEME_META[id].icon : 'palette');
  const allThemeIds = () => [...Object.keys(THEME_META), ...state.customThemes.map((c) => c.id)];

  // ---------------------------------------------------------------- icons (inline SVG, see icons.js)
  const ic = (name, cls) => window.icon(name, cls);
  /** Icon + label button content that survives later label updates (they only touch .lbl). */
  function setLabel(btn, text, iconName) {
    let lbl = btn.querySelector('.lbl');
    if (!lbl) { lbl = document.createElement('span'); lbl.className = 'lbl'; btn.append(lbl); }
    lbl.textContent = text;
    if (iconName) { const old = btn.querySelector('.i'); const n = ic(iconName); if (old) old.replaceWith(n); else btn.prepend(n); }
  }
  function applyStaticIcons() {
    for (const node of document.querySelectorAll('[data-icon]')) {
      if (node.querySelector(':scope > .i')) continue;
      const text = [...node.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (text.length) { const lbl = document.createElement('span'); lbl.className = 'lbl'; text[0].replaceWith(lbl); lbl.textContent = text[0].textContent.trim(); }
      node.prepend(ic(node.dataset.icon));
    }
  }
  const EXT_ICON = { js: 'file-code', jsx: 'file-code', ts: 'file-code', tsx: 'file-code', mjs: 'file-code', cjs: 'file-code', py: 'file-code', sh: 'file-terminal', ps1: 'file-terminal', bat: 'file-terminal', cmd: 'file-terminal',
    java: 'coffee', kt: 'file-code', xml: 'file-code', html: 'file-code', css: 'file-code', scss: 'file-code', json: 'file-json', yml: 'file-cog', yaml: 'file-cog', toml: 'file-cog', properties: 'file-cog', env: 'lock',
    md: 'file-text', txt: 'file-text', log: 'file-text', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', ico: 'image', sql: 'database', lock: 'lock' };
  const fileIcon = (name) => EXT_ICON[(name.includes('.') ? name.split('.').pop() : '').toLowerCase()] || 'file';

  const cfgNum = (key, dflt) => { const v = Number(state.project && state.project.config && state.project.config[key]); return v >= 8 && v <= 32 ? v : dflt; };
  const scrollbackSetting = () => { const v = Math.round(Number(state.project && state.project.config && state.project.config.terminalScrollback)); return v >= 200 && v <= 50000 ? v : 2000; };
  function applyFonts() {
    MONO = MONO_FONTS[monoFontId()].family;
    document.documentElement.style.setProperty('--font-mono', MONO);
    const e = cfgNum('editorFontSize', 13); const t = cfgNum('terminalFontSize', 13);
    if (editor) editor.updateOptions({ fontSize: e, fontFamily: MONO });
    if (diffEditor) diffEditor.updateOptions({ fontSize: e, fontFamily: MONO });
    for (const entry of state.terms.values()) { entry.term.options.scrollback = scrollbackSetting(); entry.term.options.fontSize = t; entry.term.options.fontFamily = MONO; try { entry.fit.fit(); } catch { /* hidden */ } }
  }
  async function changeFontSize(delta) {
    const cur = await api.settings.get();
    const base = cfgNum('editorFontSize', 13);
    const next = delta === 0 ? 13 : Math.min(32, Math.max(8, base + delta));
    await api.settings.save({ ...cur.settings, editorFontSize: next, terminalFontSize: next });
    await loadProject();
    setStatus(`Font size ${next}px`);
  }

  /** Fonts must be loaded before Monaco/xterm measure characters, otherwise cursor and selection are misplaced. */
  async function loadFonts() {
    // every mono font is preloaded here, not just the one currently chosen: the config holding monoFont is not
    // loaded yet at this point in startup (initEditors() runs before loadProject()), and these are all small,
    // bundled, local files - loading the handful not actually in use costs nothing worth branching for.
    const monoNames = ['Roboto Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono'];
    try {
      await Promise.all([
        '400 13px Roboto', '500 13px Roboto', '700 13px Roboto',
        ...monoNames.flatMap((n) => [`400 13px "${n}"`, `700 13px "${n}"`]),
      ].map((f) => document.fonts.load(f)));
    } catch { /* fall back to the system fonts */ }
  }

  const themeToggleTarget = () => {
    if (isCustomId(themeSetting)) { const c = findCustomTheme(themeSetting); return c && c.dark === false ? 'dark' : 'light'; }
    const t = THEME_TOGGLE[themeSetting]; return typeof t === 'function' ? t() : t;
  };
  function applyTheme() {
    let t = resolvedTheme();
    let custom = isCustomId(t) ? findCustomTheme(t) : null;
    if (isCustomId(t) && !custom) t = 'dark'; // the selected custom theme was deleted elsewhere
    document.documentElement.dataset.theme = custom ? 'custom' : t;
    document.documentElement.style.colorScheme = custom ? (custom.dark === false ? 'light' : 'dark') : '';
    applyCustomVars(custom ? custom.vars : null);
    if (window.monaco) window.monaco.editor.setTheme(custom ? ensureMonacoCustomTheme(custom.id, custom.vars) : MONACO_THEMES[t]);
    const termTheme = custom ? buildTermTheme(custom.vars) : TERM_THEMES[t];
    for (const entry of state.terms.values()) entry.term.options.theme = termTheme;
    const b = document.getElementById('btn-theme');
    if (b) { b.replaceChildren(ic(themeIcon(themeSetting))); b.title = `Theme: ${themeLabel(themeSetting)} — click for ${themeLabel(themeToggleTarget())} (every theme is in Settings → General)`; }
  }
  darkQuery.addEventListener('change', () => { if (themeSetting === 'system') applyTheme(); });

  const state = {
    project: null,
    tabs: [],            // { id, kind: 'file'|'diff', rel, original?, originalText? }
    activeTab: null,
    models: new Map(),   // rel -> { rel, model, saved, dirty }
    terms: new Map(),    // key -> { key, title, term, fit, container, id, exited }
    history: { limit: 300, data: null, open: null, info: null },
    blame: { on: false, rel: null, lines: null },
    bottom: 'problems',
    zen: false,          // distraction-free: hides the rail, sidebar, bottom panel and status bar - transient, not persisted
    focusedTerm: null,
    termSeq: 0,
    changes: [],
    checkpoints: [],
    expanded: new Set(),
    sideTab: 'files',
    lastResult: null,
    checksRunning: false,
    runProgress: { done: [], running: null },
    autoCheck: false,
    onlyMine: true,
    search: { regex: false, caseSensitive: false },
    quick: { files: [], stale: true, sel: 0, items: [], symbols: [] },
    review: { used: false, running: false, output: '', error: '' },
    todos: { items: [], scanning: false, truncated: false },
    bookmarks: new Map(), // rel -> Set<line> - local to this machine (session.json), not git-shared
    commitMsg: '',
    task: { allow: '', summary: '', baseline: null, reviewed: {}, started: null },
    scope: null,
    summaryPrompt: '',
    runs: null,          // { main, runs, current } from the main process
    customThemes: [],    // [{ id, label, dark, seed: { bg, fg, accent }, vars }], from settings (see src/core/custompalette.js)
  };
  let monaco; let editor; let diffEditor; let editor2; let splitRel = null; // the rel shown in the split pane, or null when it's closed
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  // ---------------------------------------------------------------- monaco
  function loadMonaco() {
    return new Promise((resolve, reject) => {
      window.require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    });
  }

  async function initEditors() {
    await loadFonts();
    monaco = await loadMonaco();
    try {
      // Real diagnostics come from the quality gates (tsc/ESLint); the bundled TS service has no node_modules to resolve against.
      const ts = monaco.typescript || (monaco.languages && monaco.languages.typescript);
      ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
      ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
    } catch { /* optional */ }
    monaco.editor.defineTheme('bazinga-hc', { base: 'hc-black', inherit: true, rules: [], colors: {
      'editor.background': '#000000', 'editor.foreground': '#ffffff',
      'editorCursor.foreground': '#ffffff', 'editor.selectionBackground': '#003a5c',
      'editorLineNumber.foreground': '#a3a3a3', 'editorLineNumber.activeForeground': '#ffffff',
    } });
    monaco.editor.defineTheme('bazinga-hc-light', { base: 'hc-light', inherit: true, rules: [], colors: {
      'editor.background': '#ffffff', 'editor.foreground': '#000000',
      'editorCursor.foreground': '#000000', 'editor.selectionBackground': '#cfe0ff',
      'editorLineNumber.foreground': '#595959', 'editorLineNumber.activeForeground': '#000000',
    } });
    monaco.editor.defineTheme('bazinga-night', { base: 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': '#1a130d', 'editor.foreground': '#ecd9bb', 'editor.lineHighlightBackground': '#2e2114',
      'editorCursor.foreground': '#ecd9bb', 'editor.selectionBackground': '#4a331a',
      'editorLineNumber.foreground': '#8a7256', 'editorLineNumber.activeForeground': '#ecd9bb',
    } });
    monaco.editor.defineTheme('bazinga-nerd', { base: 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': '#000000', 'editor.foreground': '#39ff6a', 'editor.lineHighlightBackground': '#0f1f0f',
      'editorCursor.foreground': '#39ff6a', 'editor.selectionBackground': '#0a3d35',
      'editorLineNumber.foreground': '#2fae52', 'editorLineNumber.activeForeground': '#39ff6a',
    } });
    monaco.editor.defineTheme('bazinga-tron', { base: 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': '#000000', 'editor.foreground': '#7df9ff', 'editor.lineHighlightBackground': '#081c2c',
      'editorCursor.foreground': '#00e5ff', 'editor.selectionBackground': '#063a4a',
      'editorLineNumber.foreground': '#2d5c6b', 'editorLineNumber.activeForeground': '#7df9ff',
    } });
    monaco.editor.defineTheme('bazinga-wargames', { base: 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': '#000000', 'editor.foreground': '#ffb000', 'editor.lineHighlightBackground': '#241a08',
      'editorCursor.foreground': '#ffcc33', 'editor.selectionBackground': '#4d3a0a',
      'editorLineNumber.foreground': '#7a5c14', 'editorLineNumber.activeForeground': '#ffb000',
    } });
    const common = {
      theme: MONACO_THEMES[resolvedTheme()], automaticLayout: true, minimap: { enabled: minimapOn() }, fontSize: 13,
      fontFamily: MONO, scrollBeyondLastLine: false,
      renderWhitespace: 'none', glyphMargin: true, stickyScroll: { enabled: true },
    };
    editor = monaco.editor.create($('#editor'), { ...common, model: null });
    // Monaco's own sticky-scroll feature (pins the current function/class signature while you scroll its body)
    // needs a DocumentSymbolProvider to know what's "current" - fed from the same per-file symbol cache
    // (name/kind/line/endLine) breadcrumbs and the outline panel already use, via the same symbolChildren()
    // containment logic, just shaped into Monaco's nested DocumentSymbol tree instead of a flat chain/list.
    const MONACO_SYMBOL_KIND = { class: monaco.languages.SymbolKind.Class, method: monaco.languages.SymbolKind.Method, function: monaco.languages.SymbolKind.Function };
    const toDocumentSymbols = (syms, parent) => symbolChildren(syms, parent).map((s) => ({
      name: s.name, detail: '', kind: MONACO_SYMBOL_KIND[s.kind] || monaco.languages.SymbolKind.Function, tags: [],
      range: new monaco.Range(s.line, 1, s.endLine, 1), selectionRange: new monaco.Range(s.line, 1, s.line, 1),
      children: toDocumentSymbols(syms, s),
    }));
    monaco.languages.registerDocumentSymbolProvider(monaco.languages.getLanguages().map((l) => l.id), {
      provideDocumentSymbols: (model) => {
        if (model.uri.scheme !== 'file') return [];
        return toDocumentSymbols(breadcrumbSymbols.get(model.uri.path.replace(/^\//, '')) || [], null);
      },
    });
    // a second, plain view of whatever file is sent to it via "Split right" - shares state.models (same
    // underlying document, edits in either pane apply to both), but intentionally has none of the main
    // editor's own addAction()s (bookmarks, breakpoints, debug, etc.) - those are per-editor-instance in
    // Monaco. Any *language*-registered provider (codelens, completions, markers) still applies to it too.
    editor2 = monaco.editor.create($('#editor2'), { ...common, model: null });
    $('#editor2-close').addEventListener('click', closeSplit);
    monaco.editor.onDidChangeMarkers((uris) => { for (const u of uris) if (u.scheme === 'file') applyErrorLens(u.path.slice(1)); });
    editor.addAction({ id: 'bazinga.localHistory', label: 'Local history of this file…', contextMenuGroupId: 'navigation', contextMenuOrder: 9, run: () => { const t = activeTab(); if (t && t.kind === 'file') openLocalHistory(t.rel, t.root); } });
    // one provider registered against every language Monaco knows at startup, not re-registered per snippet
    // change - it reads snippetsCache live, so editing .ide/snippets.yaml (or saving a selection) just works.
    monaco.languages.registerCompletionItemProvider(monaco.languages.getLanguages().map((l) => l.id), {
      provideCompletionItems: (model, position) => {
        const lang = model.getLanguageId();
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return { suggestions: snippetsCache.filter((s) => !s.language || s.language === lang).map((s) => ({
          label: s.prefix, kind: monaco.languages.CompletionItemKind.Snippet, insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: s.description || 'Snippet', range,
        })) };
      },
    });
    editor.addAction({ id: 'bazinga.saveSnippet', label: 'Save selection as snippet…', contextMenuGroupId: 'navigation', contextMenuOrder: 12, run: () => saveSelectionAsSnippet() });
    diffEditor = monaco.editor.createDiffEditor($('#diff'), { ...common, renderSideBySide: true, originalEditable: false });
    diffEditor.onDidUpdateDiff(updateDiffBar);
    const addCommentAction = { id: 'bazinga.reviewComment', label: 'Add review comment for the agent…', contextMenuGroupId: 'navigation', contextMenuOrder: 8, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM], run: () => commentAtCursor() };
    editor.addAction(addCommentAction);
    editor.addAction({ id: 'bazinga.mdPreview', label: 'Markdown: toggle preview', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV], precondition: undefined, run: () => toggleMarkdownPreview() });
    diffEditor.getModifiedEditor().addAction(addCommentAction);
    diffEditor.getModifiedEditor().onMouseDown((e) => { if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) { const t = activeTab(); if (t && t.kind === 'diff' && !t.ro) commentOnLine(t.rel, e.target.position.lineNumber); } });
    // the glyph margin has one job per file: a real breakpoint where a debugger could use one, a bookmark everywhere
    // else - clicking it on a file with no debug adapter used to silently toggle a breakpoint dot that did nothing.
    editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return;
      const t = activeTab(); if (!t || t.kind !== 'file') return;
      if (canRealDebug(t.rel)) toggleBreakpoint(t.rel, e.target.position.lineNumber);
      else toggleBookmark(t.rel, e.target.position.lineNumber);
    });
    editor.onDidChangeCursorPosition(() => { paintBlame(); renderBreadcrumbs(); });
    editor.onDidChangeModel(() => paintCoverage());
    for (const [id, label, which] of [['bazinga.openVsCode', 'Open in VS Code', 'vscode'], ['bazinga.openIdea', 'Open in IntelliJ IDEA', 'idea']]) editor.addAction({ id, label, contextMenuGroupId: 'navigation', contextMenuOrder: 9, run: () => openInOtherEditor(which) });
    editor.addAction({ id: 'bazinga.debugFile', label: 'Debug this file (Python, Go, Dart)', contextMenuGroupId: 'navigation', contextMenuOrder: 10, run: () => { const t = activeTab(); if (t && t.kind === 'file' && canRealDebug(t.rel)) startDebugging(t.rel); } });
    editor.addAction({ id: 'bazinga.toggleBookmark', label: 'Toggle bookmark', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyK], contextMenuGroupId: 'navigation', contextMenuOrder: 11, run: (ed) => toggleBookmarkAtCursor(ed) });
    editor.addAction({ id: 'bazinga.nextBookmark', label: 'Go to next bookmark', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyJ], run: () => jumpBookmark(1) });
    editor.addAction({ id: 'bazinga.prevBookmark', label: 'Go to previous bookmark', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyJ], run: () => jumpBookmark(-1) });
    editor.addAction({ id: 'bazinga.splitRight', label: 'Split editor right', contextMenuGroupId: 'navigation', contextMenuOrder: 13, run: () => splitRight() });
    registerTestLenses();
    registerSymbolLenses();
    registerLspProviders();
    registerInlineCompletionProvider();
  }

  const fileUri = (rel) => monaco.Uri.from({ scheme: 'file', path: `/${rel}` });
  const headUri = (rel) => monaco.Uri.from({ scheme: 'head', path: `/${rel}` });

  // `root` names which open workspace folder `rel` is relative to - defaults to the primary one, since most jump-to
  // callers (bookmarks, breadcrumbs, outline, LSP go-to-definition) don't thread a root through yet. Known limitation:
  // if two open folders both have a file at this same relative path, opening either reuses the same cached model/tab.
  async function ensureModel(rel, root = state.project && state.project.root) {
    let m = state.models.get(rel);
    if (m) return m;
    const res = await api.fs.read(root, rel);
    if (res.binary) return { unsupported: 'Binary file' };
    if (res.tooLarge) return { unsupported: 'File is larger than 2 MB' };
    const text = res.content || '';
    const model = monaco.editor.createModel(text, undefined, fileUri(rel));
    m = { rel, root, model, saved: text, dirty: false };
    let bcTimer = null;
    model.onDidChangeContent(() => {
      const dirty = norm(model.getValue()) !== norm(m.saved);
      if (dirty !== m.dirty) { m.dirty = dirty; renderTabs(); }
      clearTimeout(bcTimer);
      bcTimer = setTimeout(() => loadBreadcrumbSymbols(rel), 400);
    });
    state.models.set(rel, m);
    applyMarkers(rel);
    lspTrackModel(rel, model);
    paintBreakpoints(rel);
    paintBookmarks(rel);
    loadBreadcrumbSymbols(rel);
    return m;
  }

  // ---------------------------------------------------------------- findings (shared by Problems, markers, status, agent prompts)
  function visibleFindings() {
    const r = state.lastResult;
    if (!r || !r.findings) return [];
    return state.onlyMine ? r.findings.filter((f) => !f.legacy) : r.findings;
  }
  function countOf(list) {
    const c = { error: 0, warning: 0, info: 0 };
    for (const f of list) c[f.severity] = (c[f.severity] || 0) + 1;
    return c;
  }
  const hiddenLegacy = () => (state.lastResult && state.lastResult.findings ? state.lastResult.findings.filter((f) => f.legacy).length : 0);

  function applyMarkers(rel) {
    const m = state.models.get(rel);
    if (!m) return;
    const findings = visibleFindings().filter((f) => f.file === rel && f.line);
    const lines = m.model.getLineCount();
    const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
    monaco.editor.setModelMarkers(m.model, 'quality-gate', findings.map((f) => {
      const line = Math.min(f.line, lines);
      return {
        severity: sev[f.severity] || sev.info,
        message: `${f.message}  [${f.tool}${f.rule ? ` ${f.rule}` : ''}]`,
        startLineNumber: line, startColumn: f.column || 1,
        endLineNumber: line, endColumn: f.column ? f.column + 1 : m.model.getLineMaxColumn(line),
        source: f.tool,
      };
    }));
  }
  const applyAllMarkers = () => { for (const rel of state.models.keys()) applyMarkers(rel); };

  // ---------------------------------------------------------------- error lens (each diagnostic inline at the end of its line, not only a squiggly underline)
  const errorLensIds = new Map(); // rel -> decoration ids, so the next pass can replace rather than pile up
  const errorLensOn = () => { const cfg = state.project && state.project.config && state.project.config.errorLens; return !cfg || cfg.enabled !== false; };
  function applyErrorLens(rel) {
    const m = state.models.get(rel);
    if (!m) return;
    const prev = errorLensIds.get(rel) || [];
    if (!errorLensOn()) { if (prev.length) errorLensIds.set(rel, m.model.deltaDecorations(prev, [])); return; }
    const markers = monaco.editor.getModelMarkers({ resource: m.model.uri });
    const bestPerLine = new Map(); // line -> worst marker on it
    const rank = { [monaco.MarkerSeverity.Error]: 3, [monaco.MarkerSeverity.Warning]: 2, [monaco.MarkerSeverity.Info]: 1, [monaco.MarkerSeverity.Hint]: 0 };
    for (const mk of markers) {
      const cur = bestPerLine.get(mk.startLineNumber);
      if (!cur || (rank[mk.severity] || 0) > (rank[cur.severity] || 0)) bestPerLine.set(mk.startLineNumber, mk);
    }
    const sevClass = { [monaco.MarkerSeverity.Error]: 'error', [monaco.MarkerSeverity.Warning]: 'warning', [monaco.MarkerSeverity.Info]: 'info', [monaco.MarkerSeverity.Hint]: 'info' };
    const decos = [...bestPerLine.entries()].map(([line, mk]) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        after: { content: `  ${mk.message.split('\n')[0].slice(0, 120)}`, inlineClassName: `errorlens-${sevClass[mk.severity] || 'info'}` },
      },
    }));
    errorLensIds.set(rel, m.model.deltaDecorations(prev, decos));
  }
  const refreshErrorLens = () => { for (const rel of state.models.keys()) applyErrorLens(rel); };

  // ---------------------------------------------------------------- minimap (off by default - see DEFAULT_CONFIG.minimap)
  const minimapOn = () => !!(state.project && state.project.config && state.project.config.minimap && state.project.config.minimap.enabled);
  const refreshMinimap = () => { const enabled = minimapOn(); for (const ed of [editor, editor2, diffEditor]) if (ed) ed.updateOptions({ minimap: { enabled } }); };
  async function toggleMinimap() { await saveSetting({ minimap: { enabled: !minimapOn() } }); setStatus(`Minimap ${minimapOn() ? 'on' : 'off'}.`); }

  // ---------------------------------------------------------------- tabs
  const activeTab = () => state.tabs.find((t) => t.id === state.activeTab) || null;

  // pinned tabs sit first (in their own relative order), survive "Close others"/"Close all", and show a pin
  // instead of being just another tab among many - the same protection VS Code's pinned tabs give you.
  function toggleTabPin(id) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = state.tabs[i];
    t.pinned = !t.pinned;
    state.tabs.splice(i, 1);
    state.tabs.splice(state.tabs.filter((x) => x.pinned).length, 0, t);
    renderTabs();
    scheduleSessionSave();
  }
  async function closeOtherTabs(id) { for (const t of [...state.tabs]) if (t.id !== id && !t.pinned) await closeTab(t.id); }
  async function closeAllTabs() { for (const t of [...state.tabs]) if (!t.pinned) await closeTab(t.id); }
  function tabMenuItems(t) {
    return [
      { label: t.pinned ? 'Unpin' : 'Pin', onclick: () => toggleTabPin(t.id) },
      { label: 'Close', onclick: () => closeTab(t.id) },
      { label: 'Close others', onclick: () => closeOtherTabs(t.id) },
      { label: 'Close all', onclick: () => closeAllTabs() },
    ];
  }

  function renderTabs() {
    const bar = $('#tabbar');
    bar.replaceChildren(...state.tabs.map((t) => {
      if (t.kind === 'rest') {
        const tab = el('div', { class: `tab${t.id === state.activeTab ? ' active' : ''}${t.pinned ? ' pinned' : ''}`, title: t.url || 'New HTTP request' },
          t.pinned ? ic('pin', 'tab-ico') : ic('globe', 'tab-ico'), el('span', { text: t.title || 'HTTP request' }),
          el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, ic('x')));
        tab.addEventListener('click', () => activateTab(t.id));
        tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(t.id); });
        tab.addEventListener('contextmenu', (e) => { e.preventDefault(); popupMenu(e.clientX, e.clientY, tabMenuItems(t)); });
        return tab;
      }
      const m = state.models.get(t.rel);
      const name = t.rel.split('/').pop() + (t.ro ? ` @ ${t.title}` : '');
      const tab = el('div', { class: `tab${t.id === state.activeTab ? ' active' : ''}${t.pinned ? ' pinned' : ''}`, title: t.rel },
        t.pinned ? ic('pin', 'tab-ico') : (t.kind === 'diff' ? ic('git-compare', 'tab-ico diff') : ic(fileIcon(name), 'tab-ico')),
        el('span', { text: name }),
        m && m.dirty ? el('span', { class: 'dirty', text: '●' }) : null,
        el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, ic('x')));
      tab.addEventListener('click', () => activateTab(t.id));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(t.id); });
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); popupMenu(e.clientX, e.clientY, tabMenuItems(t)); });
      return tab;
    }));
  }

  // ---------------------------------------------------------------- Markdown preview (sanitised: no scripts, no remote images, links only open on click)
  let previewDisposable = null;
  const isMarkdown = (rel) => /\.(md|markdown|mdown)$/i.test(rel || '');
  function markdownToNode(text) {
    const html = window.marked.parse(String(text), { gfm: true, async: false });
    const clean = window.DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math'], FORBID_ATTR: ['style', 'srcset', 'formaction'], ALLOW_DATA_ATTR: false });
    const box = document.createElement('div');
    box.className = 'md';
    box.innerHTML = clean;
    for (const a of box.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      a.removeAttribute('href'); a.removeAttribute('target');
      if (/^https:\/\//i.test(href) || (/^[^:#?]+(?:#.*)?$/.test(href) && !href.startsWith('/') )) { a.dataset.href = href; a.className = 'md-link'; a.title = href; }
    }
    for (const img of box.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) continue;
      const note = document.createElement('span'); note.className = 'md-img muted'; note.textContent = `[image${img.alt ? `: ${img.alt}` : ''}]`; note.title = 'Images are not loaded in the preview';
      img.replaceWith(note);
    }
    renderMermaidBlocks(box);
    return box;
  }

  // Mermaid diagrams (```mermaid blocks) in the preview. The 5 MB library is loaded on the first diagram only. Labels are plain text (no HTML labels),
  // mermaid's own strict mode is on, and the SVG it returns is sanitised again before it is inserted.
  let mermaidLoading = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidLoading) {
      mermaidLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '../../node_modules/mermaid/dist/mermaid.min.js';
        sc.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid did not load')));
        sc.onerror = () => { mermaidLoading = null; reject(new Error('mermaid could not be loaded')); };
        document.head.appendChild(sc);
      });
    }
    return mermaidLoading;
  }
  let mermaidSeq = 0;
  function renderMermaidBlocks(box) {
    const blocks = [...box.querySelectorAll('pre > code.language-mermaid')];
    if (!blocks.length) return;
    const holders = blocks.map((code) => {
      const holder = document.createElement('div');
      holder.className = 'md-mermaid';
      holder.dataset.source = code.textContent;
      holder.textContent = 'Drawing the diagram…';
      code.parentElement.replaceWith(holder);
      return holder;
    });
    loadMermaid().then(async (mermaid) => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'inherit' });
      for (const holder of holders) {
        const source = holder.dataset.source;
        try {
          const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, source);
          const clean = window.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script', 'image', 'a'], FORBID_ATTR: ['href', 'xlink:href', 'onload'] });
          holder.innerHTML = clean;
          holder.title = 'Mermaid diagram';
        } catch (err) {
          holder.className = 'md-mermaid md-mermaid-error';
          const msg = document.createElement('div'); msg.className = 'hint danger'; msg.textContent = `Diagram error: ${String((err && err.message) || err).split('\n')[0]}`;
          const pre = document.createElement('pre'); pre.textContent = source;
          holder.replaceChildren(msg, pre);
          for (const stray of document.querySelectorAll(`#dmmd-${mermaidSeq}`)) stray.remove(); // mermaid leaves its error drawing in the page
        }
      }
    }).catch((err) => { for (const h of holders) h.textContent = String((err && err.message) || err); });
  }
  function paintPreview(text, rel, keepScroll) {
    const host = $('#md-preview');
    const top = keepScroll ? host.scrollTop : 0;
    let node;
    try { node = markdownToNode(text); } catch (err) { node = el('div', { class: 'hint danger', text: `Could not render: ${err.message}` }); }
    host.replaceChildren(node);
    host.dataset.rel = rel;
    host.scrollTop = top;
  }
  function toggleMarkdownPreview() {
    const tab = activeTab();
    if (!tab || tab.kind !== 'file' || !isMarkdown(tab.rel)) { setStatus('Open a Markdown file to preview it.'); return; }
    tab.preview = !tab.preview;
    activateTab(tab.id);
  }
  // a file dropped anywhere outside a terminal must not make the window navigate to it
  document.addEventListener('dragover', (ev) => ev.preventDefault());
  document.addEventListener('drop', (ev) => ev.preventDefault());
  $('#md-toggle').addEventListener('click', toggleMarkdownPreview);
  $('#md-preview').addEventListener('click', async (ev) => {
    const a = ev.target.closest && ev.target.closest('a.md-link');
    if (!a) return;
    ev.preventDefault();
    const href = a.dataset.href || '';
    if (/^https:\/\//i.test(href)) { api.openExternal(href); return; }
    const rel = $('#md-preview').dataset.rel || '';
    const target = href.split('#')[0];
    if (!target) return;
    const base = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
    const parts = `${base}${decodeURIComponent(target)}`.split('/'); const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    if (!(await openFile(out.join('/')))) setStatus(`Could not open ${out.join('/')}`);
  });

  async function activateTab(id, pos) {
    state.activeTab = id;
    const tab = activeTab();
    $('#welcome').classList.toggle('hidden', !!tab);
    const mdTab = !!tab && tab.kind === 'file' && isMarkdown(tab.rel);
    const previewing = mdTab && !!tab.preview;
    $('#editor').classList.toggle('hidden', !tab || tab.kind !== 'file' || previewing);
    $('#md-toggle').classList.toggle('hidden', !mdTab);
    $('#md-preview').classList.toggle('hidden', !previewing);
    const showCrumbs = !!tab && tab.kind === 'file' && !previewing;
    $('#breadcrumbs').classList.toggle('hidden', !showCrumbs);
    $('#editor-host').classList.toggle('with-crumbs', showCrumbs);
    if (showCrumbs) renderBreadcrumbs();
    if (state.bottom === 'outline') renderOutline();
    if (mdTab) setLabel($('#md-toggle'), previewing ? 'Edit' : 'Preview', previewing ? 'file-code' : 'eye');
    if (previewDisposable) { previewDisposable.dispose(); previewDisposable = null; }
    $('#diff').classList.toggle('hidden', !tab || tab.kind !== 'diff');
    $('#diffbar').classList.toggle('hidden', !tab || tab.kind !== 'diff');
    $('#editor-host').classList.toggle('with-bar', !!tab && tab.kind === 'diff');
    $('#diffbar').classList.toggle('ro', !!(tab && tab.ro));
    $('#rest').classList.toggle('hidden', !tab || tab.kind !== 'rest');
    if (tab && tab.kind === 'rest') { renderRestTab(tab); renderTabs(); scheduleSessionSave(); return; }
    if (tab) {
      const m = tab.ro ? null : state.models.get(tab.rel);
      if (tab.kind === 'file') {
        editor.setModel(m.model);
        // Monaco computes CodeLenses on its own schedule when a model is attached - under heavy load it has
        // occasionally not engaged at all for a whole run (not a transient per-call failure the provider's own
        // retry logic would catch, since that only fires after Monaco calls provideCodeLenses at least once).
        // A one-shot check for "nothing logged for this model yet" nudges it directly, without looping forever.
        { const lensModel = m.model, lensSince = Date.now();
          setTimeout(() => {
            if (editor.getModel() !== lensModel) return; // moved on to a different tab/model meanwhile
            if (!(state.lensDebug || []).some((e) => e.rel === lensModel.uri.path && e.t >= lensSince)) symbolLensChanged.fire();
          }, 2000);
        }
        if (previewing) {
          paintPreview(m.model.getValue(), tab.rel);
          let t = null;
          previewDisposable = m.model.onDidChangeContent(() => { clearTimeout(t); t = setTimeout(() => paintPreview(m.model.getValue(), tab.rel, true), 200); });
          renderTabs(); scheduleSessionSave();
          return;
        }
        if (pos && pos.line) {
          const line = Math.min(pos.line, m.model.getLineCount());
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: pos.column || 1 });
        }
        editor.focus();
      } else {
        diffEditor.updateOptions({ readOnly: !!tab.ro, originalEditable: false });
        diffEditor.setModel({ original: tab.original, modified: tab.modified || m.model });
        diffEditor.getModifiedEditor().focus();
        updateDiffBar();
        refreshSymbolDiff(tab);
      }
    } else {
      editor.setModel(null);
      diffEditor.setModel(null); // otherwise it keeps pointing at models that are about to be disposed
    }
    renderTabs();
    refreshBlame();
    scheduleSessionSave();
  }

  async function openFile(rel, line, column, root = state.project && state.project.root) {
    const id = `file:${rel}`;
    if (!state.tabs.some((t) => t.id === id)) {
      const m = await ensureModel(rel, root);
      if (m.unsupported) { setStatus(`${rel}: ${m.unsupported}`); return false; }
      state.tabs.push({ id, kind: 'file', rel, root });
    }
    await activateTab(id, { line, column });
    return true;
  }

  async function openDiff(rel, root = state.project && state.project.root) {
    const id = `diff:${rel}`;
    if (!state.tabs.some((t) => t.id === id)) {
      const m = await ensureModel(rel, root);
      if (m.unsupported) { setStatus(`${rel}: ${m.unsupported}`); return false; }
      const originalText = await api.git.head(root, rel);
      const original = monaco.editor.createModel(originalText, undefined, headUri(rel));
      state.tabs.push({ id, kind: 'diff', rel, root, original, originalText });
    }
    await activateTab(id);
    return true;
  }

  async function closeTab(id) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = state.tabs[i];
    const m = tab.ro ? null : state.models.get(tab.rel);
    // the split pane also holds a reference to a model outside the tab list - don't dispose out from under it
    const lastRef = state.tabs.filter((t) => t.rel === tab.rel && !t.ro).length === 1 && splitRel !== tab.rel;
    if (m && m.dirty && lastRef && !window.confirm(`Discard unsaved changes to ${tab.rel}?`)) return;
    if (tab.kind === 'rest') {
      if (tab.sending) api.rest.cancel(tab.id); // no point letting it run to the timeout once its tab is gone
      if (restBodyEditor && restBodyEditor.tabId === tab.id) disposeRestBodyEditor();
      if (restRespEditor && restRespEditor.tabId === tab.id) disposeRestRespEditor();
    }
    state.tabs.splice(i, 1);
    if (diffEditor) diffEditor.setModel(null);
    if (tab.original) tab.original.dispose();
    if (tab.modified) tab.modified.dispose();
    if (m && lastRef) { dropComments(tab.rel); m.model.dispose(); state.models.delete(tab.rel); }
    if (state.activeTab === id) {
      const next = state.tabs[Math.min(i, state.tabs.length - 1)];
      await activateTab(next ? next.id : null);
    } else { renderTabs(); scheduleSessionSave(); }
  }

  async function closeTabsFor(rel, root = state.project && state.project.root) {
    const m = state.models.get(rel);
    if (m) m.dirty = false; // the caller already decided to discard edits
    for (const t of state.tabs.filter((x) => x.rel === rel && (x.root || root) === root)) await closeTab(t.id);
  }

  async function saveActive() {
    const tab = activeTab();
    const m = tab && state.models.get(tab.rel);
    if (!m) return;
    const value = m.model.getValue();
    await api.fs.write(m.root, tab.rel, value);
    m.saved = value;
    m.dirty = false;
    renderTabs();
    setStatus(`Saved ${tab.rel}`);
    refreshChanges();
  }

  async function reloadFromDisk() {
    // every tab on its own: one file that vanished or cannot be read must never stop the others from refreshing
    for (const m of [...state.models.values()]) {
      if (m.dirty) continue;
      try {
        const res = await api.fs.read(m.root, m.rel);
        if (!res || res.error || res.missing || res.binary || res.tooLarge) continue;
        const text = res.content || '';
        if (norm(text) !== norm(m.saved)) { m.saved = text; m.model.setValue(text); }
      } catch { /* deleted or unreadable: keep what the tab shows */ }
    }
    for (const t of state.tabs) {
      if (t.kind !== 'diff' || t.ro) continue;
      try {
        const head = await api.git.head(t.root, t.rel);
        if (head !== t.originalText) { t.originalText = head; t.original.setValue(head); }
      } catch { /* next time */ }
    }
  }

  // ---------------------------------------------------------------- diff toolbar: next/prev, revert hunk, stage, revert file
  const diffChanges = () => (diffEditor && diffEditor.getLineChanges()) || [];

  function updateDiffBar() {
    const tab = activeTab();
    if (!tab || tab.kind !== 'diff') return;
    const n = diffChanges().length;
    $('#d-info').textContent = tab.ro ? `${tab.title || ''} · ${n} change${n === 1 ? '' : 's'}` : n ? `${n} change${n === 1 ? '' : 's'}` : 'no differences';
    $('#d-comment').disabled = !!tab.ro;
    if (tab.ro) return;
    const c = state.changes.find((x) => x.path === tab.rel && x.root === tab.root);
    setLabel($('#d-stage'), c && c.staged && !c.unstaged ? 'Unstage file' : 'Stage file', c && c.staged && !c.unstaged ? 'minus' : 'plus');
    const rv = $('#d-reviewed');
    rv.disabled = !taskHash(tab.rel);
    setLabel(rv, isReviewed(tab.rel) ? 'Reviewed' : 'Mark reviewed', isReviewed(tab.rel) ? 'check-check' : 'check');
  }

  // semantic diff: classes/methods/functions added, removed, renamed or moved, instead of raw line changes
  function symbolChangeLabel(c) {
    const kind = c.kind === 'class' ? 'class' : c.kind === 'method' ? 'method' : 'function';
    switch (c.type) {
      case 'renamed': return `Renamed ${kind} ${c.name} → ${c.newName}`;
      case 'moved': return `Moved ${kind} ${c.name} (line ${c.oldLine} → ${c.newLine})`;
      case 'modified': return `Changed ${kind} ${c.name}`;
      case 'added': return `Added ${kind} ${c.name}`;
      case 'removed': return `Removed ${kind} ${c.name}`;
      default: return `${kind} ${c.name}`;
    }
  }
  function jumpToSymbolChange(c) {
    const line = c.newLine || c.oldLine;
    const ed = c.newLine ? diffEditor.getModifiedEditor() : diffEditor.getOriginalEditor();
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
  }
  async function refreshSymbolDiff(tab) {
    const box = $('#d-symbols');
    box.classList.add('hidden');
    box.onclick = null;
    if (!tab || tab.kind !== 'diff') return;
    const originalText = tab.originalText !== undefined ? tab.originalText : tab.original.getValue();
    const modified = tab.modified || (state.models.get(tab.rel) && state.models.get(tab.rel).model);
    if (!modified) return;
    const res = await api.symbols.diff({ rel: tab.rel, original: originalText, modified: modified.getValue() });
    if (activeTab() !== tab || res.error || !res.changes || !res.changes.length) return;
    setLabel(box, `${res.changes.length} symbol change${res.changes.length === 1 ? '' : 's'}`);
    box.classList.remove('hidden');
    box.onclick = () => {
      const r = box.getBoundingClientRect();
      popupMenu(r.left, r.bottom + 4, res.changes.map((c) => ({ label: symbolChangeLabel(c), onclick: () => jumpToSymbolChange(c) })));
    };
  }

  // ---------------------------------------------------------------- review comments on diff lines
  state.comments = state.comments || new Map(); // id -> { id, rel, text, deco }
  let commentSeq = 0;
  const commentLine = (c) => { const m = state.models.get(c.rel); const r = m && m.model.getDecorationRange(c.deco); return r ? r.startLineNumber : null; };
  function refreshCommentUi() {
    const n = state.comments.size;
    const b = $('#d-send-comments');
    b.classList.toggle('hidden', !n);
    setLabel(b, `Send ${n} comment${n === 1 ? '' : 's'}`, 'send');
  }
  function dropComments(rel) {
    for (const [id, c] of [...state.comments]) if (c.rel === rel) state.comments.delete(id);
    refreshCommentUi(); scheduleSessionSave();
  }
  function commentAt(rel, line) { return [...state.comments.values()].find((c) => c.rel === rel && commentLine(c) === line); }
  function addCommentAt(rel, line, text) {
    const m = state.models.get(rel);
    if (!m || !text.trim()) return false;
    const existing = commentAt(rel, line);
    if (existing) { existing.text = text.trim(); m.model.deltaDecorations([existing.deco], [{ range: new monaco.Range(line, 1, line, 1), options: commentDeco(text.trim()) }]).forEach((d) => { existing.deco = d; }); refreshCommentUi(); scheduleSessionSave(); return true; }
    const [deco] = m.model.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: commentDeco(text.trim()) }]);
    const id = ++commentSeq;
    state.comments.set(id, { id, rel, text: text.trim(), deco });
    refreshCommentUi(); scheduleSessionSave();
    return true;
  }
  const commentDeco = (text) => ({ isWholeLine: true, className: 'bazinga-comment-line', glyphMarginClassName: 'bazinga-comment-glyph', glyphMarginHoverMessage: { value: `**Review comment** (sent to the agent)\n\n${text.replace(/[\\`*_{}[\]<>]/g, '\\$&')}` }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges });
  function commentOnLine(rel, line) {
    const existing = commentAt(rel, line);
    const text = window.prompt(existing ? 'Edit the comment (empty removes it):' : `Comment on ${rel}:${line} (sent to the agent):`, existing ? existing.text : '');
    if (text === null) return;
    if (existing && !text.trim()) {
      const m = state.models.get(rel); if (m) m.model.deltaDecorations([existing.deco], []);
      state.comments.delete(existing.id); refreshCommentUi(); scheduleSessionSave(); return;
    }
    addCommentAt(rel, line, text);
  }
  function commentAtCursor() {
    const tab = activeTab();
    if (!tab || tab.ro || (tab.kind !== 'diff' && tab.kind !== 'file')) { setStatus('Open a file or its diff to comment on a line.'); return; }
    const ed = tab.kind === 'diff' ? diffEditor.getModifiedEditor() : editor;
    const pos = ed.getPosition();
    if (pos) commentOnLine(tab.rel, pos.lineNumber);
  }
  function pickAgentTerminal() {
    return new Promise((resolve) => {
      const live = [...state.terms.values()].filter((t) => t.agent && t.id !== null && !t.exited);
      if (!live.length) { window.alert('No agent terminal is running. Start an agent first (top bar or New agent run).'); resolve(null); return; }
      const here = live.filter((t) => t.cwd === state.project.root);
      const cands = here.length ? here : live;
      if (cands.length === 1) { resolve(cands[0]); return; }
      const sel = el('select', null, ...cands.map((t, i) => el('option', { value: String(i), text: t.title })));
      const done = (v) => { $('#modal').classList.add('hidden'); resolve(v); };
      $('#dialog').replaceChildren(el('h3', { text: 'Send comments to which agent?' }), el('div', { class: 'field' }, sel),
        el('div', { class: 'actions' }, el('button', { onclick: () => done(null) }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: () => done(cands[Number(sel.value)]) }, ic('send'), 'Send')));
      $('#modal').classList.remove('hidden');
    });
  }
  async function sendComments(forTarget) {
    const list = [];
    for (const c of state.comments.values()) {
      const line = commentLine(c); const m = state.models.get(c.rel);
      if (line && m) list.push({ file: c.rel, line, text: c.text, code: m.model.getLineContent(line) });
    }
    const res = await api.review.format(list);
    if (res.error || !res.text) { setStatus(res.error || 'Nothing to send.'); return false; }
    const target = forTarget && forTarget.term ? forTarget : await pickAgentTerminal();
    if (!target) return false;
    api.pty.write(target.id, `\x1b[200~${res.text}\x1b[201~`);
    await sleep(150);
    api.pty.write(target.id, '\r');
    for (const c of state.comments.values()) { const m = state.models.get(c.rel); if (m) m.model.deltaDecorations([c.deco], []); }
    const n = state.comments.size;
    state.comments.clear(); refreshCommentUi(); scheduleSessionSave();
    setStatus(`Sent ${n} comment${n === 1 ? '' : 's'} to ${target.title}.`);
    return true;
  }

  function gotoChange(dir) {
    const changes = diffChanges();
    if (!changes.length) return;
    const mod = diffEditor.getModifiedEditor();
    const cur = mod.getPosition().lineNumber;
    const starts = changes.map((c) => Math.max(c.modifiedStartLineNumber, 1));
    const target = dir > 0 ? (starts.find((s) => s > cur) ?? starts[0]) : ([...starts].reverse().find((s) => s < cur) ?? starts[starts.length - 1]);
    mod.revealLineInCenter(target);
    mod.setPosition({ lineNumber: target, column: 1 });
    mod.focus();
  }

  /** Undo one change of the diff: put the original lines back into the working-copy model (save afterwards). */
  function revertChange(ch, originalModel, model) {
    const { originalStartLineNumber: oS, originalEndLineNumber: oE, modifiedStartLineNumber: mS, modifiedEndLineNumber: mE } = ch;
    const eol = model.getEOL();
    const orig = oE === 0 ? '' : originalModel.getValueInRange(new monaco.Range(oS, 1, oE, originalModel.getLineMaxColumn(oE))).replace(/\r?\n/g, eol);
    const R = monaco.Range;
    const last = model.getLineCount();
    let range; let text;
    if (mE === 0) {                       // lines were deleted: put them back after line mS
      if (mS === 0) { range = new R(1, 1, 1, 1); text = orig + eol; }
      else if (mS >= last) { const col = model.getLineMaxColumn(last); range = new R(last, col, last, col); text = eol + orig; }
      else { range = new R(mS + 1, 1, mS + 1, 1); text = orig + eol; }
    } else if (oE === 0) {                // lines were added: remove them
      if (mE < last) range = new R(mS, 1, mE + 1, 1);
      else if (mS > 1) range = new R(mS - 1, model.getLineMaxColumn(mS - 1), mE, model.getLineMaxColumn(mE));
      else range = new R(1, 1, mE, model.getLineMaxColumn(mE));
      text = '';
    } else {                              // lines were modified: swap the original back in
      range = new R(mS, 1, mE, model.getLineMaxColumn(mE));
      text = orig;
    }
    model.pushEditOperations([], [{ range, text }], () => null);
  }

  function revertHunk() {
    const tab = activeTab();
    if (!tab || tab.kind !== 'diff') return false;
    const m = state.models.get(tab.rel);
    const cur = diffEditor.getModifiedEditor().getPosition().lineNumber;
    const ch = diffChanges().find((c) => (c.modifiedEndLineNumber === 0 ? cur === c.modifiedStartLineNumber || cur === c.modifiedStartLineNumber + 1 : cur >= c.modifiedStartLineNumber && cur <= c.modifiedEndLineNumber));
    if (!ch) { setStatus('Click inside the change you want to undo (right side), then press "Revert this change".'); return false; }
    revertChange(ch, tab.original, m.model);
    setStatus(`Change reverted in the editor. Press ${MOD}+S to write it to disk.`);
    return true;
  }

  /** git add -p for the change under the cursor of the diff's right side. */
  async function stageChangeAtCursor(unstage) {
    const tab = activeTab();
    if (!tab || tab.kind !== 'diff' || tab.ro) { setStatus('Open a file from Changes first, then click inside the change.'); return false; }
    const m = state.models.get(tab.rel);
    if (m && m.dirty) { setStatus(`Save the file first (${MOD}+S): staging works on what is on disk.`); return false; }
    const line = diffEditor.getModifiedEditor().getPosition().lineNumber;
    const res = unstage ? await api.git.unstageHunk(tab.root, tab.rel, line) : await api.git.stageHunk(tab.root, tab.rel, line);
    if (res.error) { setStatus(res.error); return false; }
    await refreshChanges();
    const r = res.result || {};
    setStatus(r.staged === 'file' ? `New file staged: ${tab.rel}` : `${unstage ? 'Unstaged' : 'Staged'} one change${r.remaining ? ` (${r.remaining} more ${unstage ? 'staged' : 'unstaged'} in this file)` : ''}.`);
    return true;
  }

  async function toggleStage(rel, root = state.project && state.project.root) {
    const c = state.changes.find((x) => x.path === rel && x.root === root);
    const res = c && c.staged && !c.unstaged ? await api.git.unstage(root, [rel]) : await api.git.stage(root, [rel]);
    if (res.error) setStatus(res.error);
    await refreshChanges();
  }

  async function revertWholeFile(rel, root = state.project && state.project.root) {
    const c = state.changes.find((x) => x.path === rel && x.root === root);
    const what = c && c.status === '?' ? 'delete this new file' : 'throw away ALL changes to this file';
    if (!window.confirm(`Really ${what}?\n\n${rel}\n\nThis cannot be undone (unless you made a checkpoint).`)) return;
    const res = await api.git.revert(root, rel);
    if (res.error) { setStatus(res.error); return; }
    await closeTabsFor(rel, root);
    await refreshChanges();
    setStatus(`Reverted ${rel}`);
  }

  // ---------------------------------------------------------------- language servers (opt-in): hover, definition, references, completion, signature help, diagnostics
  const lspSt = { enabled: false, docs: new Set(), timers: new Map(), states: {} };
  const LSP_LANGS = ['java', 'python', 'typescript', 'javascript', 'kotlin', 'go', 'rust', 'csharp', 'yaml'];
  const relOfModel = (model) => (model.uri.scheme === 'file' ? model.uri.path.replace(/^\//, '') : null);
  const lspRange = (r) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
  const lspPos = (p) => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const lspLive = (model) => { const rel = relOfModel(model); return rel && lspSt.enabled && lspSt.docs.has(rel) ? rel : null; };
  const lspAsk = async (rel, kind, pos) => { const res = await api.lsp.request(rel, kind, lspPos(pos)); return res && !res.error ? res.result : null; };

  const mdOf = (c) => {
    if (!c) return [];
    if (Array.isArray(c)) return c.flatMap(mdOf);
    if (typeof c === 'string') return [{ value: c }];
    if (c.language) return [{ value: `\`\`\`${c.language}\n${c.value}\n\`\`\`` }];
    return c.value ? [{ value: c.value }] : [];
  };

  async function lspHoverAt(model, pos) {
    const rel = lspLive(model); if (!rel) return null;
    const res = await lspAsk(rel, 'hover', pos);
    const contents = res && mdOf(res.contents);
    return contents && contents.length ? { contents, range: res.range ? lspRange(res.range) : undefined } : null;
  }
  async function lspLocationsAt(model, pos, kind) {
    const rel = lspLive(model); if (!rel) return null;
    const locs = (await lspAsk(rel, kind, pos)) || [];
    await Promise.all([...new Set(locs.map((l) => l.rel))].map((r) => ensureModel(r))); // peek views need the target files as models
    return locs.filter((l) => state.models.has(l.rel)).map((l) => ({ uri: fileUri(l.rel), range: lspRange(l.range) }));
  }
  const KIND = () => { const K = monaco.languages.CompletionItemKind; return [null, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter]; };
  async function lspCompletionsAt(model, pos) {
    const rel = lspLive(model); if (!rel) return null;
    const res = await lspAsk(rel, 'completion', pos);
    const items = Array.isArray(res) ? res : (res && res.items) || [];
    const word = model.getWordUntilPosition(pos);
    const dflt = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
    const kinds = KIND();
    return {
      incomplete: !!(res && res.isIncomplete),
      suggestions: items.slice(0, 200).map((i) => {
        const edit = i.textEdit && (i.textEdit.range || i.textEdit.replace);
        return {
          label: i.label, kind: kinds[i.kind] ?? monaco.languages.CompletionItemKind.Text, detail: i.detail,
          documentation: i.documentation ? { value: typeof i.documentation === 'string' ? i.documentation : i.documentation.value } : undefined,
          insertText: (i.textEdit && i.textEdit.newText) || i.insertText || i.label, range: edit ? lspRange(edit) : dflt, sortText: i.sortText, filterText: i.filterText,
        };
      }),
    };
  }
  async function lspRenameAt(model, pos, newName) {
    const rel = lspLive(model); if (!rel) return null;
    const res = await api.lsp.request(rel, 'rename', { ...lspPos(pos), newName });
    const edits = res && !res.error ? res.result : null;
    if (!edits) return null;
    await Promise.all(Object.keys(edits).map((r) => ensureModel(r)));
    const out = [];
    for (const [r, list] of Object.entries(edits)) {
      if (!state.models.has(r)) continue; // a file ensureModel could not open (e.g. gitignored, or outside the project) is dropped rather than applied half-blind
      for (const e of list) out.push({ resource: fileUri(r), textEdit: { range: lspRange(e.range), text: e.newText } });
    }
    return out.length ? { edits: out } : null;
  }
  async function lspSignatureAt(model, pos) {
    const rel = lspLive(model); if (!rel) return null;
    const res = await lspAsk(rel, 'signatureHelp', pos);
    if (!res || !res.signatures || !res.signatures.length) return null;
    return {
      value: {
        activeSignature: res.activeSignature || 0, activeParameter: res.activeParameter || 0,
        signatures: res.signatures.map((sig) => ({
          label: sig.label, documentation: sig.documentation ? { value: typeof sig.documentation === 'string' ? sig.documentation : sig.documentation.value } : undefined,
          parameters: (sig.parameters || []).map((p) => ({ label: p.label, documentation: p.documentation ? { value: typeof p.documentation === 'string' ? p.documentation : p.documentation.value } : undefined })),
        })),
      },
      dispose() {},
    };
  }

  function registerLspProviders() {
    for (const lang of LSP_LANGS) {
      monaco.languages.registerHoverProvider(lang, { provideHover: (m, p) => lspHoverAt(m, p) });
      monaco.languages.registerDefinitionProvider(lang, { provideDefinition: (m, p) => lspLocationsAt(m, p, 'definition') });
      monaco.languages.registerReferenceProvider(lang, { provideReferences: (m, p) => lspLocationsAt(m, p, 'references') });
      monaco.languages.registerCompletionItemProvider(lang, { triggerCharacters: ['.', ':', '>', '"', "'", '/', '@', '#', '<'], provideCompletionItems: (m, p) => lspCompletionsAt(m, p) });
      monaco.languages.registerSignatureHelpProvider(lang, { signatureHelpTriggerCharacters: ['(', ','], provideSignatureHelp: (m, p) => lspSignatureAt(m, p) });
      monaco.languages.registerRenameProvider(lang, { provideRenameEdits: (m, p, newName) => lspRenameAt(m, p, newName) });
    }
    // go-to-definition into another project file opens it as a tab
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selection) => {
        if (resource.scheme !== 'file') return false;
        const rel = resource.path.replace(/^\//, '');
        if (!state.models.has(rel)) return false;
        openFile(rel, selection && (selection.startLineNumber || selection.lineNumber), selection && (selection.startColumn || selection.column));
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- AI inline completion (ghost text, opt-in: Settings → inlineCompletion)
  // Not LSP-backed: a local model's fill-in-the-middle endpoint (Ollama only, see core/ollama.js). Off by default -
  // the main process returns { skip: true } at once when it is, so this never calls out to a model uninvited.
  let inlineCompletionSeq = 0;
  async function provideInlineCompletion(model, pos, _context, token) {
    const icCfg = (state.project && state.project.config && state.project.config.inlineCompletion) || {};
    if (!icCfg.enabled) return { items: [] };
    const seq = ++inlineCompletionSeq;
    await new Promise((res) => setTimeout(res, Number(icCfg.debounceMs) || 400));
    if (token.isCancellationRequested || seq !== inlineCompletionSeq) return { items: [] };
    const text = model.getValue();
    const offset = model.getOffsetAt(pos);
    let res;
    try { res = await api.ai.complete({ prefix: text.slice(Math.max(0, offset - 4000), offset), suffix: text.slice(offset, offset + 1000) }); } catch { return { items: [] }; }
    if (token.isCancellationRequested || seq !== inlineCompletionSeq || !res || res.error || res.skip || !res.text) return { items: [] };
    const suggestion = res.text.split(/\r?\n[ \t]*\r?\n[ \t]*\r?\n/)[0]; // stop at a double blank line: a model that keeps going past that is writing a new unrelated block, not finishing this one
    if (!suggestion.trim()) return { items: [] };
    return { items: [{ insertText: suggestion, range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column) }] };
  }
  function registerInlineCompletionProvider() {
    monaco.languages.registerInlineCompletionsProvider('*', { provideInlineCompletions: provideInlineCompletion, freeInlineCompletions: () => {} });
  }

  async function lspOpenModel(rel) {
    const m = state.models.get(rel);
    if (!m || !lspSt.enabled) return;
    const res = await api.lsp.open(rel, m.model.getValue());
    if (res && res.ok) lspSt.docs.add(rel);
  }
  function lspTrackModel(rel, model) {
    model.onDidChangeContent(() => {
      if (!lspSt.docs.has(rel)) return;
      clearTimeout(lspSt.timers.get(rel));
      lspSt.timers.set(rel, setTimeout(() => api.lsp.change(rel, model.getValue()), 250));
    });
    model.onWillDispose(() => { if (lspSt.docs.delete(rel)) api.lsp.close(rel); clearTimeout(lspSt.timers.get(rel)); });
    lspOpenModel(rel);
  }
  async function initLsp() {
    const res = await api.lsp.status();
    const was = lspSt.enabled;
    lspSt.enabled = !!(res && res.status && res.status.enabled);
    if (lspSt.enabled && !was) for (const rel of state.models.keys()) lspOpenModel(rel);
    if (!lspSt.enabled) { lspSt.docs.clear(); for (const m of state.models.values()) monaco.editor.setModelMarkers(m.model, 'lsp', []); $('#status-lsp').textContent = ''; }
  }
  api.lsp.onDiagnostics((rel, list) => {
    const m = state.models.get(rel);
    if (!m) return;
    const sev = [null, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
    monaco.editor.setModelMarkers(m.model, 'lsp', list.map((d) => ({
      severity: sev[d.severity || 1], message: d.message, source: d.source || 'language server', code: d.code !== undefined ? String(d.code) : undefined,
      startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
    })));
  });
  api.lsp.onState((st) => {
    lspSt.states[st.server] = st;
    const text = { starting: `${st.server} language server: starting…`, ready: `${st.server} language server ✓`, unavailable: `${st.server} language server: ${st.message || 'unavailable'}`, exited: `${st.server} language server stopped` }[st.state] || '';
    $('#status-lsp').textContent = text ? `${text}  ·  ` : '';
    $('#status-lsp').title = st.message || '';
  });

  // ---------------------------------------------------------------- run this test (code lenses above tests: Maven/Gradle, Vitest/Jest/node:test, pytest)
  const coverage = { on: false, deco: null, note: '' };
  const testResults = new Map(); // key -> {status, headline, at}; shown next to the lens so you can see what you already verified
  const testLensChanged = { fire: () => {}, ev: null };
  const testKey = (rel, test, all) => (all || !test ? `${rel}|*` : `${rel}|${test.suite || ''}|${test.name}`);
  const testOpts = (rel, test, all) => {
    const m = state.models.get(rel);
    return { rel, all: !!all, name: test && test.name, kind: test && test.kind, suite: test && test.suite, line: test && test.line, content: m ? m.model.getValue() : '' };
  };
  /** Old behaviour, still available: type the command into a terminal (to debug, or to watch it run). */
  async function runTestInTerminal(rel, test, all, debug = false) {
    const m = state.models.get(rel);
    const res = await api.tests.command({ ...testOpts(rel, test, all), debug });
    if (res.error) { setStatus(res.error); if (debug) window.alert(res.error); return; }
    if (m && m.dirty) await saveActive();
    await newTerminal({ title: `${debug ? '🐞' : '▶'} ${res.label}`.slice(0, 40), cwd: res.cwd, initialInput: `${res.command}\r` });
    if (res.note) setStatus(res.note);
  }
  async function openInOtherEditor(which) {
    const tab = activeTab();
    if (!tab || tab.kind !== 'file') { setStatus('Open a file first.'); return; }
    const pos = editor.getPosition();
    const res = await api.editor.open({ rel: tab.rel, line: pos ? pos.lineNumber : 1, column: pos ? pos.column : 1, which });
    setStatus(res.error ? res.error : `Opened in ${res.opened}.`);
    if (res.error) window.alert(res.error);
  }
  const VERDICT = { passed: ['✓ Passed', 'ok'], failed: ['✗ Failed', 'err'], notfound: ['⚠ No test ran', 'warn'], unavailable: ['⚠ Runner missing', 'warn'], timeout: ['⚠ Timed out', 'warn'], cancelled: ['Cancelled', 'muted'] };
  function showTestResult(rel, test, all, res) {
    const close = () => $('#modal').classList.add('hidden');
    const [label, tone] = VERDICT[res.status] || ['Done', 'muted'];
    $('#dialog').replaceChildren(
      el('h3', { class: `test-verdict ${tone}`, text: `${label}  ·  ${res.label}` }),
      el('p', { class: 'muted', text: `${res.headline}  ·  ${(res.durationMs / 1000).toFixed(1)}s` }),
      el('pre', { class: 'test-output', text: res.output || '(the runner printed nothing)' }),
      el('div', { class: 'actions' },
        el('button', { onclick: () => { close(); runTestInTerminal(rel, test, all); } }, ic('terminal'), 'Open in terminal'),
        el('button', { onclick: () => { close(); runTestFor(rel, test, all); } }, ic('refresh-cw'), 'Run again'),
        el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }
  /** Run in the app and say plainly whether it passed. Failures (and "nothing ran") open the output; a pass is just a green status. */
  async function runTestFor(rel, test, all) {
    const m = state.models.get(rel);
    if (m && m.dirty) await saveActive();
    const key = testKey(rel, test, all);
    testResults.set(key, { status: 'running', headline: 'Running…' });
    testLensChanged.fire();
    setStatus(`Running ${all || !test ? 'all tests in ' + rel : test.name}…`);
    const res = await api.tests.run(testOpts(rel, test, all));
    if (res.error) { testResults.delete(key); testLensChanged.fire(); setStatus(res.error); return; }
    testResults.set(key, { status: res.status, headline: res.headline, res });
    if (coverage.on) paintCoverage();
    testLensChanged.fire();
    setStatus(`${(VERDICT[res.status] || ['Done'])[0]}: ${res.label} (${res.headline})`);
    if (res.status !== 'passed') showTestResult(rel, test, all, res);
  }

  // lenses above classes and methods: "N usages" (click: search for the name) and "author, age · summary" (click: open that commit)
  const symbolLensChanged = { fire: () => {} }; // wired below; activateTab uses this to nudge Monaco if it never asks at all
  function registerSymbolLenses() {
    monaco.editor.registerCommand('bazinga.symbolUsages', (_accessor, name) => {
      setSideTab('search');
      if (!state.search.regex) $('#q-re').click();
      $('#q').value = `\\b${name}\\b`;
      runSearch();
    });
    monaco.editor.registerCommand('bazinga.symbolRefs', async (_accessor, rel, line, character, name) => {
      const res = await api.lsp.request(rel, 'references', { line, character, includeDeclaration: false });
      const locs = res && !res.error && Array.isArray(res.result) ? res.result : null;
      if (!locs) { window.alert('The language server did not answer. Searching by name instead.'); setSideTab('search'); $('#q').value = name; runSearch(); return; }
      const texts = new Map();
      for (const l of locs.slice(0, 60)) if (!texts.has(l.rel)) { try { texts.set(l.rel, (await api.fs.read(state.project.root, l.rel)).content.split('\n')); } catch { texts.set(l.rel, []); } }
      const close = () => $('#modal').classList.add('hidden');
      $('#dialog').replaceChildren(el('h3', { text: `Usages of ${name} (${locs.length})` }),
        el('div', { class: 'lh-list' }, ...(locs.length ? locs.slice(0, 200).map((l) => {
          const ln = l.range.start.line + 1;
          const src = ((texts.get(l.rel) || [])[ln - 1] || '').trim();
          return el('div', { class: 'lh-row', onclick: () => { close(); openFile(l.rel, ln, l.range.start.character + 1); } },
            ic('file-code'), el('span', { class: 'lh-label' }, el('b', { text: `${l.rel}:${ln}` }), el('span', { class: 'muted', text: `  ${src.slice(0, 120)}` })));
        }) : [el('div', { class: 'empty', text: 'No usages.' })])),
        el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
      $('#modal').classList.remove('hidden');
    });
    monaco.editor.registerCommand('bazinga.copyText', (_accessor, text) => { api.copy(text); setStatus(`Copied ${text}`); });
    monaco.editor.registerCommand('bazinga.showImpls', (_accessor, name, list) => {
      if (list.length === 1) { openFile(list[0].file, list[0].line); return; }
      const close = () => $('#modal').classList.add('hidden');
      $('#dialog').replaceChildren(el('h3', { text: `Implementations of ${name}` }),
        el('div', { class: 'lh-list' }, ...list.map((t) => el('div', { class: 'lh-row' }, ic('file-code'), el('span', { class: 'lh-label' }, el('b', { text: t.name }), el('span', { class: 'muted', text: `  ${t.kind} · ${t.file}:${t.line}` })), el('span', { class: 'lh-acts' }, el('button', { onclick: () => { close(); openFile(t.file, t.line); } }, ic('eye'), 'Open'))))),
        el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
      $('#modal').classList.remove('hidden');
    });
    monaco.editor.registerCommand('bazinga.symbolCommit', async (_accessor, sha) => { setSideTab('history'); await toggleCommit(sha); });
    // Monaco computes CodeLenses once when a model is attached and otherwise only on content changes, with no
    // retry of its own - a single transient failure of api.symbols.info() (main process busy with something
    // else at that exact moment) would otherwise blank the lenses for the rest of that file's open session.
    // onDidChange lets a failed attempt ask Monaco to try again shortly, bounded so a persistent failure settles
    // into silence instead of retrying forever.
    const lensRetryEmitter = new monaco.Emitter();
    const lensRetries = new Map(); // rel -> attempt count, cleared on success
    symbolLensChanged.fire = () => lensRetryEmitter.fire();
    const provider = {
      onDidChange: lensRetryEmitter.event,
      async provideCodeLenses(model) {
        const none = { lenses: [], dispose() {} };
        const log = (outcome) => { (state.lensDebug || (state.lensDebug = [])).push({ t: Date.now(), rel: model.uri.path, outcome }); if (state.lensDebug.length > 50) state.lensDebug.shift(); };
        const cfg = (state.project && state.project.config && state.project.config.symbolLenses) || {};
        if (model.uri.scheme !== 'file' || !state.project || !state.project.root || (cfg.usages === false && cfg.blame === false && cfg.spring === false)) { log('skipped (not a file, no project, or lenses off)'); return none; }
        const rel = model.uri.path.replace(/^\//, '');
        const m = state.models.get(rel);
        const retry = () => {
          const n = (lensRetries.get(rel) || 0) + 1;
          lensRetries.set(rel, n);
          if (n <= 3) setTimeout(() => lensRetryEmitter.fire(), 400 * n);
        };
        let res;
        const lensRoot = (m && m.root) || state.project.root;
        try { res = await api.symbols.info(lensRoot, rel, model.getValue(), { dirty: !!(m && m.dirty) }); } catch (err) { console.error(`symbol lenses: ${rel}`, err); log(`threw: ${err && err.message}`); retry(); return none; }
        if (!res || res.error) { console.error(`symbol lenses: ${rel}: ${(res && res.error) || 'no result'}`); log(`error: ${(res && res.error) || 'no result'}`); retry(); return none; }
        lensRetries.delete(rel);
        const lenses = [];
        for (const s of res.symbols) {
          const range = { startLineNumber: s.line, startColumn: 1, endLineNumber: s.line, endColumn: 1 };
          if (s.exactUsages !== null && s.exactUsages !== undefined) {
            lenses.push({ range, command: { id: 'bazinga.symbolRefs', title: `${s.exactUsages} usage${s.exactUsages === 1 ? '' : 's'}`, tooltip: 'Exact: found by the language server. Click to list them.', arguments: [rel, s.line - 1, s.column, s.name] } });
          } else if (s.usages !== null && s.usages !== undefined) {
            lenses.push({ range, command: { id: 'bazinga.symbolUsages', title: `${s.usages} usage${s.usages === 1 ? '' : 's'}`, tooltip: 'Counted by name across the project (text based, so same-named things elsewhere are included). Click to search.', arguments: [s.name] } });
          }
          for (const e of s.endpoints || []) {
            const url = e.path;
            lenses.push({ range, command: { id: 'bazinga.copyText', title: `$(globe) ${e.method} ${e.path}`, tooltip: 'Spring endpoint (found by pattern from the mapping annotations). Click to copy the path.', arguments: [url] } });
          }
          if (s.impls) {
            const word = s.impls.kind === 'interface' ? 'implementation' : 'subclass';
            lenses.push({ range, command: { id: 'bazinga.showImpls', title: `${s.impls.total} ${word}${s.impls.total === 1 ? '' : s.impls.kind === 'interface' ? 's' : 'es'}`, tooltip: 'Types that name this one after implements / extends (matched by simple name). Click to list them.', arguments: [s.name, s.impls.list] } });
          }
          if (s.blame) {
            const b = s.blame;
            // the lens itself stays short (who, when); the commit message is only in the hover popup, where length does not matter
            const title = b.sha ? `$(account) ${b.author}, ${ago(b.time)}${b.uncommitted ? ' (+ uncommitted)' : ''}` : '$(edit) Uncommitted changes';
            const tip = b.sha ? `${b.author} · ${new Date(b.time * 1000).toLocaleString()} · ${b.sha.slice(0, 8)}\n\n${b.summary || '(no message)'}${b.uncommitted ? '\n\n(this block also has uncommitted changes)' : ''}\n\nLast change inside this block. Click to open the commit.` : 'This block only has changes that are not committed yet.';
            lenses.push({ range, command: b.sha ? { id: 'bazinga.symbolCommit', title, tooltip: tip, arguments: [b.sha] } : { id: '', title, tooltip: tip } });
          }
        }
        log(`ok: ${lenses.length} lenses from ${res.symbols.length} symbols`);
        return { lenses, dispose() {} };
      },
    };
    for (const lang of ['java', 'javascript', 'typescript', 'python', 'kotlin', 'go', 'rust', 'csharp']) monaco.languages.registerCodeLensProvider(lang, provider);
  }

  function registerTestLenses() {
    monaco.editor.registerCommand('bazinga.runTest', (_accessor, rel, test) => runTestFor(rel, test, false));
    monaco.editor.registerCommand('bazinga.runFileTests', (_accessor, rel) => runTestFor(rel, null, true));
    monaco.editor.registerCommand('bazinga.debugTest', (_accessor, rel, test) => runTestInTerminal(rel, test, false, true));
    monaco.editor.registerCommand('bazinga.testResult', (_accessor, rel, test, all) => {
      const r = testResults.get(testKey(rel, test, all));
      if (r && r.res) showTestResult(rel, test, all, r.res);
    });
    const emitter = new monaco.Emitter();
    testLensChanged.fire = () => emitter.fire(undefined);
    const resultLens = (range, rel, test, all) => {
      const r = testResults.get(testKey(rel, test, all));
      if (!r) return null;
      const title = r.status === 'running' ? '$(sync~spin) Running…' : `${(VERDICT[r.status] || ['Done'])[0]} (${r.headline})`;
      return { range, command: r.res ? { id: 'bazinga.testResult', title, tooltip: 'Click to see the output.', arguments: [rel, test, all] } : { id: '', title } };
    };
    const provider = {
      onDidChange: emitter.event,
      async provideCodeLenses(model) {
        if (model.uri.scheme !== 'file' || !state.project || !state.project.root) return { lenses: [], dispose() {} };
        const rel = model.uri.path.replace(/^\//, '');
        let tests = [];
        try { tests = await api.tests.find(rel, model.getValue()); } catch { tests = []; }
        const lenses = [];
        if (tests.length) {
          const top = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
          lenses.push({ range: top, command: { id: 'bazinga.runFileTests', title: '$(play) Run all tests in this file', tooltip: 'Runs them here and tells you whether they passed.', arguments: [rel] } });
          const fr = resultLens(top, rel, null, true); if (fr) lenses.push(fr);
        }
        for (const t of tests) {
          const range = { startLineNumber: t.line, startColumn: 1, endLineNumber: t.line, endColumn: 1 };
          lenses.push({ range, command: { id: 'bazinga.runTest', title: t.kind === 'suite' ? '$(play) Run all in this group' : '$(play) Run test', tooltip: 'Runs just this one here and tells you whether it passed.', arguments: [rel, t] } });
          if (t.debuggable) lenses.push({ range, command: { id: 'bazinga.debugTest', title: '$(bug) Debug', tooltip: 'Starts this one test so you can step through it (pytest: in the terminal; JUnit: waits for IntelliJ on port 5005; node:test: port 9229; go test: dlv headless on 127.0.0.1:2345; dotnet/F# test: waits for Visual Studio/Rider/VS Code to attach by process id; PHPUnit: waits for an already-listening Xdebug on port 9003; RSpec/Minitest: rdbg headless on 127.0.0.1:12345; dart/flutter test: pauses and prints a VM service URL to attach to).', arguments: [rel, t] } });
          const rl = resultLens(range, rel, t, false); if (rl) lenses.push(rl);
        }
        return { lenses, dispose() {} };
      },
    };
    for (const lang of ['java', 'javascript', 'typescript', 'python', 'kotlin', 'go', 'rust', 'csharp', 'php', 'ruby', 'dart', 'fsharp', 'scala']) monaco.languages.registerCodeLensProvider(lang, provider);
  }

  // ---------------------------------------------------------------- sidebar: history (commit graph, stashes) + read-only commit diffs + line blame
  const LANE_W = 14; const ROW_H = 24;
  const SVGNS = 'http://www.w3.org/2000/svg';
  function graphSvg(row, lanes) {
    const w = Math.max(lanes, 1) * LANE_W + 6;
    const x = (l) => l * LANE_W + LANE_W / 2 + 3;
    const mid = ROW_H / 2;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', String(w)); svg.setAttribute('height', String(ROW_H)); svg.setAttribute('class', 'graph');
    const line = (x1, y1, x2, y2, lane) => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
      p.setAttribute('class', `g g${lane % 6}`);
      svg.append(p);
    };
    for (const l of row.through) line(x(l), 0, x(l), ROW_H, l);
    for (const l of row.incoming) line(x(l), 0, x(row.lane), mid, l);
    for (const l of row.outgoing) line(x(row.lane), mid, x(l), ROW_H, l);
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', String(x(row.lane))); dot.setAttribute('cy', String(mid)); dot.setAttribute('r', row.outgoing.length > 1 ? '5' : '4');
    dot.setAttribute('class', `dot g${row.lane % 6}${row.outgoing.length > 1 ? ' merge' : ''}`);
    svg.append(dot);
    return svg;
  }

  async function refreshHistory() {
    const host = $('#side-history');
    if (!state.project || !state.project.isRepo) { host.replaceChildren(el('div', { class: 'empty', text: 'History needs a git repository.' })); return; }
    const res = await api.history.log({ limit: state.history.limit });
    if (res.error) { host.replaceChildren(el('div', { class: 'empty', text: res.error })); return; }
    state.history.data = res;
    renderHistory();
  }

  async function stashAction(action, arg, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    const res = await api.history.stash(action, arg);
    if (res.error) { setStatus(res.error); window.alert(res.error); return; }
    setStatus(`Stash ${action}: ${(res.output || '').split('\n')[0] || 'done'}`);
    await refreshChanges(); await reloadFromDisk(); await refreshHistory();
  }

  /** At most two chips per commit (local branches first, then tags, then remotes) plus a "+N" chip; names never wrap. */
  function refChips(refs) {
    const kind = (r) => (/^tag: /.test(r) ? 1 : r.startsWith('origin/') ? 2 : 0);
    const sorted = [...refs].sort((a, b) => kind(a) - kind(b));
    const shown = sorted.slice(0, 2).map((r) => el('span', { class: `ref${kind(r) === 1 ? ' tag' : kind(r) === 2 ? ' remote' : ''}`, title: r.replace(/^tag: /, ''), text: r.replace(/^tag: /, '') }));
    if (sorted.length > 2) shown.push(el('span', { class: 'ref remote', title: sorted.slice(2).map((r) => r.replace(/^tag: /, '')).join('\n'), text: `+${sorted.length - 2}` }));
    return shown;
  }

  function renderHistory() {
    const host = $('#side-history');
    const d = state.history.data;
    if (!d) return;
    const maxLanes = Math.max(1, ...d.rows.map((r) => r.lanes));
    const head = el('div', { class: 'c-head' }, el('div', { class: 'line' },
      el('button', { title: 'Put your uncommitted changes (including new files) on the stash', onclick: () => { const m = window.prompt('Stash message (optional):', ''); if (m !== null) stashAction('push', m); } }, ic('archive'), 'Stash changes'),
      el('button', { class: `toggle${state.blame.on ? ' on' : ''}`, title: 'Show who last changed the line under the cursor (inline in the editor)', onclick: toggleBlame }, ic('user'), 'Blame'),
      el('button', { class: 'icon', title: 'Refresh', onclick: refreshHistory }, ic('refresh-cw'))));
    const nodes = [head];
    if (d.stashes.length) {
      nodes.push(el('div', { class: 'section-title', text: 'STASHES' }));
      for (const st of d.stashes) {
        nodes.push(el('div', { class: 'row stash', title: st.subject },
          ic('archive', 'ftype'), el('span', { class: 'name', text: st.subject.replace(/^(WIP on|On) /, '') }), el('span', { class: 'muted small', text: ago(st.time) }),
          el('span', { class: 'acts' },
            el('button', { class: 'icon', title: 'Apply (keep the stash)', onclick: () => stashAction('apply', st.ref) }, ic('archive-restore')),
            el('button', { class: 'icon', title: 'Pop (apply and delete the stash)', onclick: () => stashAction('pop', st.ref) }, ic('check')),
            el('button', { class: 'icon danger', title: 'Delete the stash', onclick: () => stashAction('drop', st.ref, `Delete ${st.ref}?\n\n${st.subject}`) }, ic('trash-2')))));
      }
    }
    nodes.push(el('div', { class: 'section-title', text: 'COMMITS' }));
    if (!d.commits.length) nodes.push(el('div', { class: 'empty', text: 'No commits yet.' }));
    d.commits.forEach((c, i) => {
      const open = state.history.open === c.sha;
      nodes.push(el('div', { class: `row commit${open ? ' sel' : ''}${c.head ? ' head' : ''}`, title: `${c.sha}\n${c.author} · ${new Date(c.time * 1000).toLocaleString()}`, onclick: () => toggleCommit(c.sha) },
        graphSvg(d.rows[i], maxLanes),
        el('span', { class: 'c-sub', title: c.subject, text: c.subject }),
        ...refChips(c.refs),
        el('span', { class: 'muted small c-meta', text: ago(c.time) })));
      if (open && state.history.info && state.history.info.sha === c.sha) {
        const info = state.history.info;
        nodes.push(el('div', { class: 'commit-detail' },
          el('pre', { class: 'c-msg', text: info.message }),
          el('div', { class: 'muted small', text: `${info.author} <${info.email}> · ${c.short}` }),
          ...info.files.map((f) => el('div', { class: 'row file', title: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, onclick: () => openCommitDiff(c.sha, f) },
            el('span', { class: `tag st-${f.status === 'R' ? 'M' : f.status}`, text: f.status }), el('span', { class: 'name', text: f.path })))));
      }
    });
    if (d.commits.length >= state.history.limit) nodes.push(el('div', { class: 'line pad' }, el('button', { onclick: () => { state.history.limit *= 2; refreshHistory(); } }, ic('arrow-down'), 'Load more…')));
    const top = host.scrollTop;
    fill(host, ...nodes);
    host.scrollTop = top;
  }

  async function toggleCommit(sha) {
    if (state.history.open === sha) { state.history.open = null; state.history.info = null; renderHistory(); return; }
    state.history.open = sha; state.history.info = null; renderHistory();
    const res = await api.history.info(sha);
    if (res.error) { setStatus(res.error); return; }
    if (state.history.open === sha) { state.history.info = res.info; renderHistory(); }
  }

  async function openCommitDiff(sha, file) {
    const id = `commit:${sha}:${file.path}`;
    if (!state.tabs.some((t) => t.id === id)) {
      const res = await api.history.diff(sha, file.path, file.oldPath);
      if (res.error) { setStatus(res.error); return; }
      const mk = (scheme, text) => monaco.editor.createModel(text, undefined, monaco.Uri.from({ scheme, path: `/${sha}/${file.path}` }));
      state.tabs.push({ id, kind: 'diff', ro: true, rel: file.path, title: sha.slice(0, 7), original: mk('commit-a', res.diff.original), modified: mk('commit-b', res.diff.modified) });
    }
    await activateTab(id);
  }

  // local history: every saved or externally changed version of a file, kept outside the project
  const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  async function openLocalDiff(rel, entry, root = state.project && state.project.root) {
    const id = `lh:${rel}:${entry.id}`;
    if (!state.tabs.some((t) => t.id === id)) {
      const old = await api.localHistory.read(root, rel, entry.id);
      if (old.error) { setStatus(old.error); return; }
      const cur = await api.fs.read(root, rel);
      const mk = (scheme, text) => monaco.editor.createModel(text, undefined, monaco.Uri.from({ scheme, path: `/${entry.id}/${rel}` }));
      state.tabs.push({ id, kind: 'diff', ro: true, rel, root, title: `${rel.split('/').pop()} @ ${ago(entry.time / 1000)}`, original: mk('lh-a', old.content), modified: mk('lh-b', cur.content || '') });
    }
    await activateTab(id);
  }

  async function openLocalHistory(rel, root = state.project && state.project.root) {
    if (!rel) { setStatus('Open a file first.'); return; }
    const close = () => $('#modal').classList.add('hidden');
    const res = await api.localHistory.list(root, rel);
    const entries = res.entries || [];
    const rows = entries.map((e, i) => el('div', { class: 'lh-row' },
      el('span', { class: 'lh-when', title: new Date(e.time).toLocaleString(), text: ago(e.time / 1000) }),
      el('span', { class: 'lh-label muted', text: `${e.label || 'version'} · ${fmtSize(e.size)}${i === 0 ? ' · newest' : ''}` }),
      el('span', { class: 'lh-acts' },
        el('button', { title: 'Compare this version with the file as it is now', onclick: async () => { close(); await openLocalDiff(rel, e, root); } }, ic('git-compare'), 'Compare'),
        el('button', { title: 'Put this version back (the current content is kept in the history first)', onclick: async () => {
          const r = await api.localHistory.restore(root, rel, e.id);
          if (r.error) { setStatus(r.error); return; }
          close(); await reloadFromDisk(); await refreshChanges(); setStatus(`Restored ${rel} to the version from ${ago(e.time / 1000)}.`);
        } }, ic('undo-2'), 'Restore'))));
    $('#dialog').replaceChildren(el('h3', { text: `Local history: ${rel}` }),
      entries.length ? el('div', { class: 'lh-list' }, ...rows) : el('div', { class: 'empty', text: 'No versions yet. A version is kept every time the file is saved here or changes on disk (also when an agent changes it).' }),
      el('div', { class: 'hint', text: 'Kept outside the project, for 30 days or 60 versions per file. Restore never loses the current content: it becomes the newest version first.' }),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }

  // blame: the line under the cursor, GitLens style
  let blameDeco = null;
  function paintBlame() {
    if (!editor) return;
    if (!blameDeco) blameDeco = editor.createDecorationsCollection([]);
    const tab = activeTab();
    const m = tab && tab.kind === 'file' ? state.models.get(tab.rel) : null;
    const pos = editor.getPosition();
    const b = state.blame.on && m && !m.dirty && state.blame.rel === tab.rel && state.blame.lines && pos ? state.blame.lines[pos.lineNumber - 1] : null;
    if (!b) { blameDeco.set([]); return; }
    const col = m.model.getLineMaxColumn(pos.lineNumber);
    blameDeco.set([{ range: new monaco.Range(pos.lineNumber, col, pos.lineNumber, col), options: { after: { content: `    ${b.committed ? `${b.author}, ${ago(b.time)} · ${b.summary}` : 'Not committed yet'}`, inlineClassName: 'blame-inline' } } }]);
  }
  async function refreshBlame() {
    const tab = activeTab();
    if (!state.blame.on || !tab || tab.kind !== 'file' || !state.project.isRepo) { paintBlame(); return; }
    if (state.blame.rel !== tab.rel) {
      state.blame.rel = null; state.blame.lines = null;
      const res = await api.history.blame(tab.rel);
      if (!res.error) { state.blame.lines = res.lines; state.blame.rel = tab.rel; }
    }
    paintBlame();
  }
  function toggleBlame() {
    state.blame.on = !state.blame.on;
    state.blame.rel = null;
    setStatus(state.blame.on ? 'Line blame on: it follows your cursor.' : 'Line blame off.');
    refreshBlame();
    if (state.history.data) renderHistory();
  }

  // ---------------------------------------------------------------- sidebar: tree
  function setSideTab(name) {
    state.sideTab = name;
    for (const b of document.querySelectorAll('#side-tabs button[data-tab]')) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const p of document.querySelectorAll('.side-pane')) p.classList.toggle('active', p.id === `side-${name}`);
    if (name === 'history') refreshHistory();
    scheduleSessionSave();
  }

  // A small pop-up menu at the pointer. items: { label, onclick, checked, disabled } or '-' (a separator). Closes on any click, Escape, scroll or blur.
  function popupMenu(x, y, items) {
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
    const menu = el('div', { class: 'ctx-menu', role: 'menu' });
    const close = () => { menu.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); };
    const away = (e) => { if (!menu.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    for (const it of items) {
      if (it === '-') { menu.append(el('div', { class: 'ctx-sep' })); continue; }
      const b = el('button', { class: `ctx-item${it.checked ? ' checked' : ''}`, role: 'menuitem', text: `${it.checked ? '✓ ' : ''}${it.label}` });
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', () => { close(); if (it.onclick) it.onclick(); });
      menu.append(b);
    }
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    const first = menu.querySelector('button:not([disabled])'); if (first) first.focus();
    return { close, menu };
  }

  // Folders marked as source / tests (core/folderroles.js). Saved in .ide/config.json, told to agents when they start.
  const FOLDER_ROLES = { source: { short: 'src', label: 'source folder' }, tests: { short: 'test', label: 'test folder' } };
  const markedFolders = () => { const f = (state.project && state.project.config && state.project.config.folders) || {}; return { source: f.source || [], tests: f.tests || [] }; };
  /** { role, folder, exact } for a path: the most specific marked folder at or above it. */
  function folderRoleOf(rel) {
    const f = markedFolders(); let best = null;
    for (const role of Object.keys(FOLDER_ROLES)) for (const dir of f[role]) if ((rel === dir || rel.startsWith(`${dir}/`)) && (!best || dir.length > best.folder.length)) best = { role, folder: dir, exact: dir === rel };
    return best;
  }
  async function markFolder(rel, role) {
    const r = await api.folders.mark(rel, role);
    if (r.error) { setStatus(r.error); return r; }
    await loadProject(); await renderTree();
    setStatus(role ? `${rel} is now a ${FOLDER_ROLES[role].label}. Agents are told from their next start${r.index ? `; ${r.index} lists it too` : ''}.` : `${rel} is no longer marked.`);
    return r;
  }
  async function detectFolders() {
    const r = await api.folders.detect();
    if (r.error) { setStatus(r.error); return r; }
    if (r.added && r.added.length) { await loadProject(); await renderTree(); }
    setStatus(r.added && r.added.length ? `Marked ${r.added.join(', ')}.` : 'No conventional source or test folders found that are not marked already (src/main/java, src/test/java, src, test, tests …).');
    return r;
  }
  // New file/folder, rename, duplicate, delete: every tab open under `rel` (or exactly `rel` for a file) is closed
  // first, since the path it points at is about to disappear or move.
  async function closeTabsUnder(root, rel, isDir) {
    const rels = isDir
      ? [...new Set(state.tabs.filter((t) => t.root === root && (t.rel === rel || t.rel.startsWith(`${rel}/`))).map((t) => t.rel))]
      : [rel];
    for (const r of rels) await closeTabsFor(r, root);
  }
  async function createEntry(root, parentRel, isDir) {
    const name = window.prompt(`Name of the new ${isDir ? 'folder' : 'file'}${parentRel ? ` (in ${parentRel})` : ''}:`, '');
    if (!name) return;
    const rel = parentRel ? `${parentRel}/${name}` : name;
    const res = await api.fs.create(root, rel, { dir: isDir });
    if (res.error) { setStatus(res.error); return; }
    if (parentRel) state.expanded.add(parentRel);
    state.quick.stale = true;
    await renderTree();
    if (!isDir) openFile(rel, undefined, undefined, root);
    setStatus(`Created ${rel}.`);
  }
  async function renameEntry(root, rel, isDir) {
    const base = rel.split('/').pop();
    const name = window.prompt(`Rename "${base}" to:`, base);
    if (!name || name === base) return;
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const toRel = parent ? `${parent}/${name}` : name;
    const wasOpen = !isDir && state.tabs.some((t) => t.rel === rel && t.root === root && t.kind === 'file');
    const res = await api.fs.rename(root, rel, toRel);
    if (res.error) { setStatus(res.error); return; }
    await closeTabsUnder(root, rel, isDir);
    state.quick.stale = true;
    await renderTree();
    if (wasOpen) await openFile(toRel, undefined, undefined, root);
    setStatus(`Renamed to ${toRel}.`);
  }
  async function duplicateEntry(root, rel) {
    const res = await api.fs.duplicate(root, rel);
    if (res.error) { setStatus(res.error); return; }
    state.quick.stale = true;
    await renderTree();
    setStatus(`Duplicated as ${res.rel}.`);
  }
  async function deleteEntry(root, rel, isDir) {
    if (!window.confirm(`Delete "${rel}"?\n\n${isDir ? 'This deletes the folder and everything inside it. ' : ''}A local-history snapshot is kept first, so this can be undone from there.`)) return;
    const res = await api.fs.delete(root, rel);
    if (res.error) { setStatus(res.error); return; }
    await closeTabsUnder(root, rel, isDir);
    state.quick.stale = true;
    await renderTree();
    setStatus(`Deleted ${rel}.`);
  }
  function rowMenu(ev, root, rel, isDir) {
    ev.preventDefault();
    const primary = root === state.project.root; // folder roles (.ide/config.json + AGENTS.md) stay primary-root only for now
    const items = [];
    if (isDir) {
      const cur = primary && folderRoleOf(rel);
      const own = cur && cur.exact ? cur.role : null;
      items.push(
        { label: 'New file…', onclick: () => createEntry(root, rel, false) },
        { label: 'New folder…', onclick: () => createEntry(root, rel, true) },
        { label: 'New HTTP request…', onclick: () => openRestTab() },
        '-',
        ...(primary ? [
          { label: 'Mark as source folder', checked: own === 'source', onclick: () => markFolder(rel, 'source') },
          { label: 'Mark as test folder', checked: own === 'tests', onclick: () => markFolder(rel, 'tests') },
          { label: 'Clear mark', disabled: !own, onclick: () => markFolder(rel, null) },
          '-',
          { label: 'Detect source and test folders', onclick: detectFolders },
        ] : []),
      );
    }
    if (rel && !isDir) items.push('-', { label: 'Open to the side', onclick: () => openInSplit(rel, root) });
    if (rel) {
      items.push('-',
        { label: 'Rename…', onclick: () => renameEntry(root, rel, isDir) },
        { label: 'Duplicate', onclick: () => duplicateEntry(root, rel) },
        { label: 'Copy relative path', onclick: () => api.copy(rel) },
        '-',
        { label: 'Delete', onclick: () => deleteEntry(root, rel, isDir) });
    }
    popupMenu(ev.clientX, ev.clientY, items);
  }

  async function renderDir(container, root, rel, depth) {
    let entries;
    try { entries = await api.fs.list(root, rel); } catch (e) { container.append(el('div', { class: 'empty', text: e.message })); return; }
    for (const e of entries) {
      // expand/collapse state is keyed by plain rel (same as before multi-root existed): two roots sharing a
      // same-named folder will share its expanded/collapsed state too - a cosmetic quirk, not a correctness issue.
      const open = e.dir && state.expanded.has(e.rel);
      const row = el('div', { class: 'row', draggable: 'true', 'data-root': root, 'data-rel': e.rel, 'data-dir': e.dir ? '1' : '0', style: `padding-left:${8 + depth * 14}px`, title: e.rel },
        e.dir ? ic(open ? 'chevron-down' : 'chevron-right', 'twisty') : el('span', { class: 'twisty' }),
        ic(e.dir ? (open ? 'folder-open' : 'folder') : fileIcon(e.name), e.dir ? 'ftype dir' : 'ftype'),
        el('span', { class: 'name', text: e.name }),
        el('span', { class: 'role' }),
        el('span', { class: 'tag' }));
      row.addEventListener('contextmenu', (ev) => rowMenu(ev, root, e.rel, e.dir));
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('application/x-bazinga-path', e.rel); ev.dataTransfer.effectAllowed = 'copy'; });
      row.addEventListener('click', async () => {
        if (e.dir) { if (open) state.expanded.delete(e.rel); else state.expanded.add(e.rel); await renderTree(); scheduleSessionSave(); } else openFile(e.rel, undefined, undefined, root);
      });
      container.append(row);
      if (open) await renderDir(container, root, e.rel, depth + 1);
    }
  }

  async function renderTree() {
    const host = $('#side-files');
    const roots = (state.project && state.project.roots) || [];
    if (!roots.length) { host.replaceChildren(el('div', { class: 'empty', text: 'Open a project folder to begin.' })); return; }
    const top = host.scrollTop;
    const fresh = el('div');
    // one open folder: no header, same look as before multi-root existed. Several: one labeled, collapsible section each.
    if (roots.length === 1) {
      await renderDir(fresh, roots[0].root, '', 0);
    } else {
      for (const p of roots) {
        const open = !state.collapsedRoots || !state.collapsedRoots.has(p.root);
        const head = el('div', { class: 'row tree-root-head', 'data-root': p.root },
          ic(open ? 'chevron-down' : 'chevron-right', 'twisty'),
          ic('folder-open', 'ftype dir'),
          el('span', { class: 'name', text: p.root === state.project.root ? `${p.name} (primary)` : p.name }));
        head.addEventListener('click', () => {
          state.collapsedRoots = state.collapsedRoots || new Set();
          if (state.collapsedRoots.has(p.root)) state.collapsedRoots.delete(p.root); else state.collapsedRoots.add(p.root);
          renderTree(); scheduleSessionSave();
        });
        head.addEventListener('contextmenu', (ev) => { ev.preventDefault(); popupMenu(ev.clientX, ev.clientY, [{ label: 'Remove folder from workspace', onclick: () => removeWorkspaceFolder(p.root) }]); });
        fresh.append(head);
        if (open) await renderDir(fresh, p.root, '', 1);
      }
    }
    host.replaceChildren(fresh);
    host.scrollTop = top;
    decorateTree();
  }

  function decorateTree() {
    for (const row of document.querySelectorAll('#side-files .row')) {
      const rel = row.dataset.rel;
      if (rel === undefined) continue; // a root-head row (section header for a workspace folder), not a file/dir row
      const root = row.dataset.root || (state.project && state.project.root);
      const changesHere = state.changes.filter((c) => c.root === root);
      const byPath = new Map(changesHere.map((c) => [c.path, c.status]));
      const tag = $('.tag', row);
      tag.className = 'tag';
      tag.textContent = '';
      const badge = $('.role', row);
      const fr = root === state.project.root && folderRoleOf(rel);
      if (badge) {
        badge.className = 'role'; badge.textContent = '';
        if (fr && fr.exact && row.dataset.dir === '1') { badge.textContent = FOLDER_ROLES[fr.role].short; badge.classList.add(`role-${fr.role}`); }
      }
      row.title = fr ? `${rel}${fr.exact ? ` — marked as a ${FOLDER_ROLES[fr.role].label}` : ` — inside the ${FOLDER_ROLES[fr.role].label} ${fr.folder}`}` : rel;
      if (row.dataset.dir === '1') {
        if (changesHere.some((c) => c.path.startsWith(`${rel}/`))) { tag.textContent = '●'; tag.classList.add('st-M'); }
      } else if (byPath.has(rel)) {
        const s = byPath.get(rel);
        tag.textContent = s === '?' ? 'U' : s;
        tag.classList.add(`st-${s}`);
      }
    }
  }

  // ---------------------------------------------------------------- sidebar: changes, commit, checkpoints
  const ago = (sec) => {
    const d = Math.max(0, Date.now() / 1000 - sec);
    if (d < 60) return 'just now';
    for (const [n, label] of [[31557600, 'y'], [2629800, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'min']]) if (d >= n) return `${Math.floor(d / n)} ${label} ago`;
    return 'just now';
  };

  function initChangesPane() {
    const msg = el('input', { type: 'text', id: 'commit-msg', placeholder: 'Commit message', spellcheck: 'false' });
    msg.addEventListener('input', () => { state.commitMsg = msg.value; });
    msg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doCommit(); } });
    const allow = el('input', { type: 'text', id: 't-allow', placeholder: 'Allowed paths, e.g. src/billing/**, docs/', spellcheck: 'false', title: 'Comma separated. Files the task changes outside these are flagged.' });
    const summary = el('textarea', { id: 't-summary', rows: '3', placeholder: 'Paste the agent’s “Files changed” summary here to cross-check it against the real diff', spellcheck: 'false' });
    let scopeTimer = null;
    const later = () => { clearTimeout(scopeTimer); scopeTimer = setTimeout(async () => { await refreshScope(); renderChanges(); scheduleSessionSave(); }, 300); };
    allow.addEventListener('input', () => { state.task.allow = allow.value; later(); });
    summary.addEventListener('input', () => { state.task.summary = summary.value; later(); });
    $('#side-changes').replaceChildren(
      el('div', { class: 'c-task' },
        el('div', { class: 'line' }, allow),
        el('div', { class: 'line' },
          el('button', { id: 't-start', title: 'Remember what is already changed (so it is not blamed on the agent) and save a checkpoint', onclick: startTask }, ic('play'), 'Start task'),
          el('button', { title: 'Forget the task: all changes count again', onclick: clearTask }, ic('x'), 'Clear'),
          el('button', { title: 'Copies an instruction that makes the agent end with a list of the files it changed', onclick: async () => { await api.copy(state.summaryPrompt || 'When you are done, end with a section "Files changed" listing every file you created, edited or deleted (full relative paths), one per line with a short reason.'); setStatus('Summary prompt copied. Paste it into the agent.'); } }, ic('clipboard-copy'), 'Copy summary prompt')),
        summary,
        el('div', { id: 't-sum', class: 'muted' })),
      el('div', { class: 'c-head' },
        el('div', { class: 'line' },
          el('button', { onclick: async () => { for (const root of new Set(state.changes.map((c) => c.root))) { const r = await api.git.stageAll(root); if (r.error) { setStatus(r.error); break; } } refreshChanges(); } }, ic('plus'), 'Stage all'),
          el('button', { title: 'Save a snapshot of the whole working tree (including new files) that you can restore later', onclick: () => makeCheckpoint('manual') }, ic('archive'), 'Checkpoint')),
        el('div', { class: 'line' }, msg, el('button', { class: 'primary', onclick: doCommit }, ic('git-commit-horizontal'), 'Commit'))),
      el('div', { id: 'c-files' }),
      el('div', { class: 'c-title', text: 'Checkpoints' }),
      el('div', { id: 'c-cps' }));
  }

  // ---- task scope: allowlist, test-edit flags, self-report cross-check, reviewed checkmarks
  const hasWarn = (rel) => !!(state.scope && (state.scope.flags[rel] || []).some((f) => f.level === 'warn'));
  const taskHash = (rel) => { const f = state.scope && state.scope.files.find((x) => x.path === rel); return f ? f.hash : null; };
  const isReviewed = (rel) => { const h = taskHash(rel); return !!h && state.task.reviewed[rel] === h; };

  function setReviewed(rel, on) {
    const h = taskHash(rel);
    if (on && h) state.task.reviewed[rel] = h; else delete state.task.reviewed[rel];
    renderChanges(); scheduleSessionSave();
  }

  function unreviewedCount() { return state.scope ? state.scope.files.filter((f) => !isReviewed(f.path)).length : 0; }

  function renderScopeSummary() {
    const box = $('#t-sum');
    if (!box) return;
    const sc = state.scope;
    if (!sc || !sc.files.length) { box.textContent = state.task.started ? 'Task started. No changes yet.' : ''; return; }
    const parts = [`${sc.files.length} file${sc.files.length === 1 ? '' : 's'} in this task`, `${unreviewedCount()} unreviewed`];
    if (sc.outOfScope.length) parts.push(`${sc.outOfScope.length} outside scope`);
    if (sc.testEdits.length) parts.push(`${sc.testEdits.length} existing test${sc.testEdits.length === 1 ? '' : 's'} edited`);
    if (sc.report) {
      if (sc.report.unexplained.length) parts.push(`${sc.report.unexplained.length} not in agent summary`);
      if (sc.report.claimedButUnchanged.length) parts.push(`agent claims unchanged: ${sc.report.claimedButUnchanged.join(', ')}`);
    }
    box.textContent = parts.join(' · ');
    box.classList.toggle('bad', sc.warnings > 0 || !!(sc.report && sc.report.claimedButUnchanged.length));
  }

  async function refreshScope() {
    if (!state.project || !state.project.isRepo) { state.scope = null; return; }
    const res = await api.scope.analyze({ baseline: state.task.baseline, allow: state.task.allow, summary: state.task.summary });
    if (res.error) { state.scope = null; return; }
    state.scope = res.analysis; state.summaryPrompt = res.summaryPrompt;
    for (const rel of Object.keys(state.task.reviewed)) if (state.task.reviewed[rel] !== taskHash(rel)) delete state.task.reviewed[rel];
  }

  async function startTask() {
    if (!state.project || !state.project.isRepo) { setStatus('Tasks need a git repository.'); return; }
    const snap = await api.scope.snapshot();
    if (snap.error) { setStatus(snap.error); return; }
    state.task.baseline = snap.baseline; state.task.reviewed = {}; state.task.started = Date.now();
    await makeCheckpoint('task start');
    await refreshChanges();
    setStatus('Task started: only changes from now on count. Start your agent.');
    scheduleSessionSave();
  }

  async function clearTask() {
    state.task = { allow: '', summary: '', baseline: null, reviewed: {}, started: null };
    $('#t-allow').value = ''; $('#t-summary').value = '';
    await refreshChanges(); scheduleSessionSave();
  }

  function renderChanges() {
    $('#changes-count').textContent = state.changes.length ? `(${state.changes.length})` : '';
    const files = $('#c-files');
    if (!state.project || !state.project.isRepo) {
      files.replaceChildren(el('div', { class: 'empty', text: 'Not a git repository: no change tracking available.' }));
    } else if (!state.changes.length) {
      files.replaceChildren(el('div', { class: 'empty', text: 'Working tree is clean. Changes made by your agent will show up here.' }));
    } else {
      const sc = state.scope;
      const inTask = new Set(sc ? sc.files.map((f) => f.path) : state.changes.map((c) => c.path));
      const rank = (c) => { if (!inTask.has(c.path)) return 3; if (hasWarn(c.path)) return 0; return isReviewed(c.path) ? 2 : 1; };
      const rootsWithChanges = [...new Set(state.changes.map((c) => c.root))];
      const groupHeader = (root) => el('div', { class: 'c-title', text: root === state.project.root ? `${rootName(root)} (primary)` : rootName(root) });
      const row = (c) => {
        const flags = (sc && sc.flags[c.path]) || [];
        const reviewed = isReviewed(c.path);
        const box = el('input', { type: 'checkbox', class: 'rev', title: inTask.has(c.path) ? 'Mark as reviewed (resets if the file changes again)' : 'Changed before the task started' });
        box.checked = reviewed; box.disabled = !inTask.has(c.path);
        box.addEventListener('click', (e) => e.stopPropagation());
        box.addEventListener('change', () => setReviewed(c.path, box.checked));
        return el('div', { class: `row${c.staged ? ' staged' : ''}${inTask.has(c.path) ? '' : ' pre'}${reviewed ? ' reviewed' : ''}`, title: c.path, onclick: () => openDiff(c.path, c.root) },
          box,
          el('span', { class: `tag st-${c.status}`, text: c.status === '?' ? 'U' : c.status }),
          el('span', { class: 'name', text: c.path }),
          ...flags.map((f) => el('span', { class: `flag ${f.level}`, title: f.text, text: f.kind === 'scope' ? 'scope' : f.kind === 'test' ? 'test' : 'unlisted' })),
          el('span', { class: 'acts' },
            el('button', { class: 'icon', title: c.staged && !c.unstaged ? 'Unstage' : 'Stage', onclick: (e) => { e.stopPropagation(); toggleStage(c.path, c.root); } }, ic(c.staged && !c.unstaged ? 'minus' : 'plus')),
            el('button', { class: 'icon', title: 'Revert this file', onclick: (e) => { e.stopPropagation(); revertWholeFile(c.path, c.root); } }, ic('undo-2'))));
      };
      // one open folder: no header noise, same look as before multi-root existed. Several: one group per folder.
      if (rootsWithChanges.length <= 1) {
        const rows = [...state.changes].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
        files.replaceChildren(...rows.map(row));
      } else {
        const nodes = [];
        for (const root of rootsWithChanges) {
          const rows = state.changes.filter((c) => c.root === root).sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
          nodes.push(groupHeader(root), ...rows.map(row));
        }
        files.replaceChildren(...nodes);
      }
    }
    renderScopeSummary();
    const cps = $('#c-cps');
    if (!state.checkpoints.length) {
      cps.replaceChildren(el('div', { class: 'empty', text: 'No checkpoints yet. One is saved automatically before each agent starts (Settings), or press "Checkpoint".' }));
    } else {
      cps.replaceChildren(...state.checkpoints.map((cp) => el('div', { class: 'cp-row', title: new Date(cp.time * 1000).toLocaleString() },
        el('span', { class: 'lbl', text: cp.label }),
        el('span', { class: 'when', text: ago(cp.time) }),
        el('button', { onclick: () => restoreCheckpoint(cp) }, ic('undo-2'), 'Restore'),
        el('button', { class: 'icon danger', title: 'Delete checkpoint', 'aria-label': 'Delete checkpoint', onclick: async () => { await api.checkpoint.remove(cp.id); refreshCheckpoints(); } }, ic('trash-2')))));
    }
    decorateTree();
    updateStatus();
    updateDiffBar();
  }

  async function refreshChanges() {
    try {
      const res = await api.git.changes();
      // a root named in failedRoots had git fail just now (index busy, mid-operation): keep its old entries
      // instead of wiping that one folder's section to "no changes" while every other root updates normally.
      const keep = res && res.failedRoots && res.failedRoots.length ? state.changes.filter((c) => res.failedRoots.includes(c.root)) : [];
      if (res && Array.isArray(res.files)) state.changes = [...res.files, ...keep];
    } catch { /* keep the previous list */ }
    try { await refreshScope(); } catch { state.scope = null; }
    renderChanges();
  }

  async function refreshCheckpoints() {
    const res = await api.checkpoint.list();
    state.checkpoints = (res && res.checkpoints) || [];
    renderChanges();
  }

  async function makeCheckpoint(label) {
    if (!state.project || !state.project.isRepo) { setStatus('Checkpoints need a git repository.'); return null; }
    const res = await api.checkpoint.create(label);
    if (res.error) { setStatus(`Checkpoint failed: ${res.error}`); return null; }
    setStatus(`Checkpoint saved: ${label}`);
    await refreshCheckpoints();
    return res.checkpoint;
  }

  async function restoreCheckpoint(cp) {
    if (!window.confirm(`Restore the working tree to "${cp.label}" (${ago(cp.time)})?\n\nFiles changed since then are overwritten and files created since then are deleted. Your current state is saved as a new checkpoint first, so this can be undone.`)) return;
    const res = await api.checkpoint.restore(cp.id);
    if (res.error) { setStatus(`Restore failed: ${res.error}`); return; }
    await reloadFromDisk();
    for (const rel of res.result.removed) if (state.models.has(rel)) await closeTabsFor(rel);
    await renderTree();
    await refreshChanges();
    await refreshCheckpoints();
    setStatus(`Restored "${cp.label}". The state before is saved as a checkpoint.`);
  }

  async function doCommit() {
    const msg = state.commitMsg.trim();
    if (!msg) { setStatus('Enter a commit message first.'); $('#commit-msg').focus(); return; }
    const un = unreviewedCount();
    const warn = state.scope ? state.scope.warnings : 0;
    if ((un || warn) && !window.confirm(`${un} changed file${un === 1 ? ' is' : 's are'} not marked reviewed and ${warn} ${warn === 1 ? 'has a warning' : 'have warnings'} (scope, edited tests, agent summary).\n\nCommit anyway?`)) return;
    // one open folder might be mid-review while another's fully staged: commit every root that has something
    // staged, with the same message, same as committing once per repo in a multi-repo source-control view.
    let targets = [...new Set(state.changes.filter((c) => c.staged).map((c) => c.root))];
    if (!targets.length) {
      if (!state.changes.length) { setStatus('Nothing to commit.'); return; }
      if (!window.confirm('Nothing is staged. Stage all changes and commit?')) return;
      targets = [...new Set(state.changes.map((c) => c.root))];
      for (const root of targets) { const r = await api.git.stageAll(root); if (r.error) { setStatus(r.error); return; } }
    }
    for (const root of targets) {
      const res = await api.git.commit(root, msg);
      if (res.error) { window.alert(`Commit failed (${root}):\n\n${res.error}`); await refreshChanges(); return; }
    }
    state.commitMsg = '';
    $('#commit-msg').value = '';
    setStatus(`Committed: ${msg}`);
    await refreshChanges();
    await reloadFromDisk();
  }

  // ---------------------------------------------------------------- sidebar: scripts
  // Spring Boot / Maven / Gradle modules found in the project (settings per module are remembered per project in this browser profile)
  const springPrefs = (root) => { try { return JSON.parse(localStorage.getItem(`bazinga.spring.${root}`) || '{}'); } catch { return {}; } };
  const saveSpringPref = (root, dir, patch) => {
    try { const all = springPrefs(root); all[dir] = { ...(all[dir] || {}), ...patch }; localStorage.setItem(`bazinga.spring.${root}`, JSON.stringify(all)); } catch { /* storage unavailable */ }
  };
  async function runBuild(mod, opts) {
    const res = await api.spring.command({ dir: mod.dir, ...opts });
    if (res.error) { setStatus(res.error); return; }
    await newTerminal({ title: `${opts.task ? '▶' : '🍃'} ${res.label}${mod.dir ? ` (${mod.dir})` : ''}`.slice(0, 40), cwd: res.cwd, env: res.env, initialInput: `${res.command}\r` });
  }
  function springSection(mod, root, saved) {
    const prefs = (springPrefs(root)[mod.dir]) || {};
    const kids = [el('div', { class: 's-file' }, ic(mod.spring ? 'coffee' : 'package'), ` ${mod.dir || '(project root)'} · ${mod.tool === 'maven' ? 'Maven' : 'Gradle'}${mod.wrapper ? ' wrapper' : ''}${mod.spring ? ' · Spring Boot' : ''}`)];
    if (mod.spring && mod.apps.length) {
      const profile = el('select', { class: 'spring-profile', title: 'Spring profile (spring.profiles.active)' },
        el('option', { value: '', text: '(default profile)' }), ...mod.profiles.map((p) => el('option', { value: p, text: p })));
      profile.value = mod.profiles.includes(prefs.profile) ? prefs.profile : '';
      const envBox = el('textarea', { class: 'spring-env', rows: 2, spellcheck: false, placeholder: 'ENV_VAR=value (one per line)', title: 'Environment variables for this run' });
      envBox.value = prefs.env || '';
      const jvm = el('input', { type: 'text', class: 'spring-jvm', spellcheck: false, placeholder: mod.tool === 'maven' ? 'JVM args, e.g. -Xmx512m' : 'JVM args (Maven only)', title: 'Options for the JVM of the application' });
      jvm.value = prefs.jvmArgs || ''; jvm.disabled = mod.tool !== 'maven';
      const dbg = el('input', { type: 'number', class: 'spring-port', min: 1024, max: 65535, placeholder: 'debug port', title: mod.tool === 'maven' ? 'Start with a JDWP debug port (the app does not wait for the debugger). Attach IntelliJ or VS Code to it.' : 'Gradle: only 5005 (--debug-jvm, waits for the debugger)' });
      dbg.value = prefs.debugPort || '';
      const fields = () => ({ profile: profile.value, env: envBox.value, jvmArgs: jvm.value, debugPort: dbg.value });
      for (const [node, key] of [[profile, 'profile'], [envBox, 'env'], [jvm, 'jvmArgs'], [dbg, 'debugPort']]) node.addEventListener('change', () => saveSpringPref(root, mod.dir, { [key]: node.value }));
      kids.push(el('div', { class: 'spring-run', title: mod.apps.map((a) => a.mainClass).join('\n') },
        el('button', { class: 'primary', onclick: () => runBuild(mod, fields()) }, ic('play'), ` Run ${mod.apps[0].mainClass.split('.').pop()}`),
        profile), envBox, el('div', { class: 'spring-run' }, jvm, dbg,
        el('button', { title: 'Save these settings as a named run configuration in .ide/run.json (shared with the team through git)', onclick: async () => {
          const name = window.prompt('Name of this run configuration:', prefs.lastName || `${mod.dir || 'app'}${profile.value ? ` (${profile.value})` : ''}`);
          if (!name) return;
          const res = await api.runConfigs.save({ name, dir: mod.dir, ...fields() });
          if (res.error) { setStatus(res.error); return; }
          saveSpringPref(root, mod.dir, { lastName: name });
          setStatus(`Saved run configuration “${name}” in .ide/run.json`); renderScripts();
        } }, ic('check'), 'Save')));
      const mine = (saved || []).filter((c) => c.dir === mod.dir);
      for (const c of mine) {
        kids.push(el('div', { class: 'row script', title: `${c.profile ? `profile ${c.profile} · ` : ''}${c.jvmArgs ? `${c.jvmArgs} · ` : ''}${c.debugPort ? `debug ${c.debugPort} · ` : ''}${c.env ? 'env set' : ''}`.replace(/ · $/, ''), onclick: () => runBuild(mod, { profile: c.profile, env: c.env, jvmArgs: c.jvmArgs, debugPort: c.debugPort }) },
          ic('play', 'st-A'), el('span', { class: 'name', text: c.name }), c.debugPort ? el('span', { class: 'chip', text: `debug ${c.debugPort}` }) : null,
          el('span', { class: 'acts' }, el('button', { class: 'icon danger', title: 'Delete this configuration', onclick: async (ev) => { ev.stopPropagation(); await api.runConfigs.remove(c.name); renderScripts(); } }, ic('trash-2')))));
      }
    }
    if (mod.spring) kids.push(el('div', { class: 'spring-tasks' }, el('button', { class: 'chip-btn', title: 'All HTTP endpoints, @Bean methods and stereotype classes of the project', onclick: openSpringOverview }, ic('layout-dashboard'), 'endpoints & beans…')));
    kids.push(el('div', { class: 'spring-tasks' }, ...mod.tasks.map((t) => el('button', { class: 'chip-btn', title: `Run “${t}”`, onclick: () => runBuild(mod, { task: t }) }, ic('play'), t))));
    return el('div', { class: 'spring-mod' }, ...kids);
  }

  let springSeq = 0;
  async function renderScripts() {
    const host = $('#side-scripts');
    const scripts = (state.project && state.project.scripts) || [];
    if (!state.project || !state.project.root) { host.replaceChildren(el('div', { class: 'empty', text: 'Open a project folder first.' })); return; }
    const mySeq = ++springSeq;
    let modules = [];
    let saved = [];
    try { const d = await api.spring.detect(); modules = (d && d.modules) || []; } catch { modules = []; }
    try { saved = (await api.runConfigs.list()).configs || []; } catch { saved = []; }
    if (mySeq !== springSeq) return; // a newer render is running
    const nodes = [];
    if (modules.length) nodes.push(el('div', { class: 'spring-head', text: 'Build and run' }), ...modules.map((m) => springSection(m, state.project.root, saved)));
    if (!scripts.length) {
      nodes.push(el('div', { class: 'empty' },
        'No scripts yet. Add ', el('b', { text: '.ide/scripts.yaml' }), ' to your project:',
        el('pre', { class: 'detail', text: 'scripts:\n  - name: Import dry run\n    command: python scripts/import.py --dry-run\n    description: Safe preview' })));
    } else {
      if (modules.length) nodes.push(el('div', { class: 'spring-head', text: 'Scripts' }));
      nodes.push(...scripts.map((s) => el('div', { class: 'row script', title: s.command, onclick: () => runScript(s.name) },
        ic('play', 'st-A'), el('span', { class: 'name', text: s.name }), el('span', { class: 'desc', text: s.description }))));
    }
    fill(host, ...nodes);
  }

  async function runScript(name) {
    const prep = await api.scripts.prepare(name);
    if (prep.error) { setStatus(prep.error); return; }
    await newTerminal({ title: name, cwd: prep.cwd, initialInput: `${prep.command}\r` });
  }

  // ---------------------------------------------------------------- sidebar: project search
  let searchTimer = null;
  async function runSearch() {
    const query = $('#q').value;
    const meta = $('#search-meta');
    const box = $('#search-results');
    if (!query) { meta.textContent = ''; box.replaceChildren(); return; }
    meta.textContent = 'Searching…';
    const res = await api.search.run({ query, regex: state.search.regex, caseSensitive: state.search.caseSensitive });
    if (query !== $('#q').value) return; // a newer search is running
    if (res.error) { meta.textContent = res.error; box.replaceChildren(); return; }
    const hits = res.results || [];
    const fileCount = new Set(hits.map((h) => `${h.root}:${h.file}`)).size;
    meta.textContent = `${hits.length}${res.truncated ? '+' : ''} result${hits.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'} (${res.engine})`;
    const multiRoot = new Set(hits.map((h) => h.root)).size > 1;
    const nodes = [];
    let lastFile; let lastRoot;
    for (const h of hits.slice(0, 600)) {
      if (multiRoot && h.root !== lastRoot) { nodes.push(el('div', { class: 'c-title', text: rootName(h.root) })); lastRoot = h.root; lastFile = null; }
      if (h.file !== lastFile) { nodes.push(el('div', { class: 's-file', text: h.file })); lastFile = h.file; }
      nodes.push(el('div', { class: 's-hit', title: `${h.file}:${h.line}`, onclick: async () => {
        if (await openFile(h.file, h.line, h.column, h.root) && !state.search.regex) {
          const m = state.models.get(h.file);
          if (m && editor.getModel() === m.model) editor.setSelection(new monaco.Range(h.line, h.column, h.line, h.column + query.length));
        }
      } }, el('span', { class: 'ln', text: String(h.line) }), el('span', { class: 'tx', text: h.text })));
    }
    if (hits.length > 600) nodes.push(el('div', { class: 'empty', text: `Showing the first 600 of ${hits.length}. Narrow the search.` }));
    box.replaceChildren(...nodes);
  }
  const scheduleSearch = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); };

  function focusSearch() {
    setSideTab('search');
    const sel = editor && editor.getModel() && editor.getSelection() && !editor.getSelection().isEmpty() ? editor.getModel().getValueInRange(editor.getSelection()) : '';
    if (sel && !sel.includes('\n')) $('#q').value = sel;
    $('#q').focus();
    $('#q').select();
    if ($('#q').value) runSearch();
  }

  // ---------------------------------------------------------------- quick open (Ctrl+P)
  function fuzzy(query, p) {
    const q = query.toLowerCase();
    const s = p.toLowerCase();
    const base = s.lastIndexOf('/') + 1;
    let qi = 0; let score = 0; let last = -2;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] !== q[qi]) continue;
      score += 1;
      if (i === last + 1) score += 3;
      if (i === base || '/-_.'.includes(s[i - 1] || '')) score += 4;
      if (i >= base) score += 2;
      last = i;
      qi++;
    }
    return qi < q.length ? -1 : score - s.length * 0.01;
  }

  async function openQuickOpen() {
    if (!state.project || !state.project.root) return;
    state.quick.mode = 'files';
    $('#quickopen').classList.remove('hidden');
    const input = $('#qo-input');
    input.value = '';
    input.placeholder = 'Go to file…';
    input.focus();
    if (state.quick.stale) {
      const res = await api.fs.allFiles();
      state.quick.files = (res && res.files) || [];
      state.quick.stale = false;
    }
    renderQuick();
  }
  const closeQuickOpen = () => { $('#quickopen').classList.add('hidden'); if (editor) editor.focus(); };

  /** "Go to symbol in workspace": every class/method/function in the project (tree-sitter, same parser the symbol lenses use), fuzzy-filtered client-side like the file list above. */
  async function openGotoSymbol() {
    if (!state.project || !state.project.root) return;
    state.quick.mode = 'symbols';
    $('#quickopen').classList.remove('hidden');
    const input = $('#qo-input');
    input.value = '';
    input.placeholder = 'Go to symbol in workspace…';
    input.focus();
    $('#qo-list').replaceChildren(el('div', { class: 'qo-row muted', text: 'Indexing…' }));
    const res = await api.symbols.workspaceAll();
    state.quick.symbols = (res && res.symbols) || [];
    renderQuick();
  }

  const SYMBOL_ICON = { class: 'box', method: 'square-function', function: 'square-function' };
  function renderQuick() {
    const q = $('#qo-input').value.trim();
    if (state.quick.mode === 'symbols') {
      const all = state.quick.symbols || [];
      const multiRootSym = (state.project && state.project.roots || []).length > 1;
      const items = (q ? all.map((s) => ({ s, sc: fuzzy(q, s.name) })).filter((x) => x.sc >= 0).sort((a, b) => b.sc - a.sc).map((x) => x.s) : all).slice(0, 60);
      state.quick.items = items;
      state.quick.sel = Math.min(state.quick.sel, Math.max(items.length - 1, 0));
      $('#qo-list').replaceChildren(...(items.length ? items.map((s, i) => el('div', { class: `qo-row${i === state.quick.sel ? ' sel' : ''}`, title: `${MOD}+click: open to the side`, onclick: (e) => pickQuick(i, e) },
        ic(SYMBOL_ICON[s.kind] || 'square-function', 'qo-ico'), el('span', { text: s.name }), el('span', { class: 'dir', text: `${multiRootSym ? rootName(s.root) + ' · ' : ''}${s.rel}:${s.line}` })))
        : [el('div', { class: 'qo-row muted', text: q ? 'No symbols match.' : 'No symbols indexed (nothing parseable, or an empty project).' })]));
      const selSym = $('#qo-list .sel');
      if (selSym) selSym.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (state.quick.mode === 'commands') {
      const all = commandList();
      const items = (q ? all.map((c) => ({ c, s: fuzzy(q, c.title) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.c) : all).slice(0, 40);
      state.quick.items = items;
      state.quick.sel = Math.min(state.quick.sel, Math.max(items.length - 1, 0));
      $('#qo-list').replaceChildren(...items.map((c, i) => el('div', { class: `qo-row${i === state.quick.sel ? ' sel' : ''}`, onclick: () => pickQuick(i) },
        ic(c.icon, 'qo-ico'), el('span', { text: c.title }), el('span', { class: 'dir', text: c.keys || '' }))));
      const selc = $('#qo-list .sel');
      if (selc) selc.scrollIntoView({ block: 'nearest' });
      return;
    }
    const multiRoot = (state.project && state.project.roots || []).length > 1;
    let items;
    if (!q) {
      const open = state.tabs.filter((t) => t.kind === 'file').map((t) => ({ rel: t.rel, root: t.root }));
      const all = [...state.quick.files];
      const seen = new Set();
      items = [...open, ...all].filter((it) => { const k = `${it.root}:${it.rel}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    } else {
      items = state.quick.files.map((f) => ({ f, s: fuzzy(q, f.rel) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.f);
    }
    state.quick.items = items;
    state.quick.sel = Math.min(state.quick.sel, Math.max(items.length - 1, 0));
    $('#qo-list').replaceChildren(...items.map((it, i) => {
      const f = it.rel;
      const slash = f.lastIndexOf('/');
      const dir = slash > 0 ? f.slice(0, slash) : '';
      return el('div', { class: `qo-row${i === state.quick.sel ? ' sel' : ''}`, title: `${MOD}+click: open to the side`, onclick: (e) => pickQuick(i, e) },
        el('span', { text: f.slice(slash + 1) }), el('span', { class: 'dir', text: multiRoot ? `${rootName(it.root)}${dir ? ' · ' + dir : ''}` : dir }));
    }));
    const sel = $('#qo-list .sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function pickQuick(i, e) {
    const f = state.quick.items[i];
    if (!f) return;
    closeQuickOpen();
    if (state.quick.mode === 'commands') { f.run(); return; }
    const toSide = e && (IS_MAC ? e.metaKey : e.ctrlKey);
    if (state.quick.mode === 'symbols') { if (toSide) openInSplit(f.rel, f.root); else openFile(f.rel, f.line, undefined, f.root); return; }
    if (toSide) openInSplit(f.rel, f.root); else openFile(f.rel, undefined, undefined, f.root);
  }

  // ---------------------------------------------------------------- command palette (Ctrl+Shift+P)
  function commandList() {
    const tab = activeTab();
    const cmds = [
      ['Go to file…', 'search', openQuickOpen, 'goToFile'],
      ['Go to symbol in workspace…', 'square-function', openGotoSymbol, 'goToSymbol'],
      ['Open project folder…', 'folder-open', () => $('#btn-open').click()],
      ['New terminal', 'square-terminal', () => newTerminal({ title: 'Terminal' }), 'newTerminal'],
      ['New agent run…', 'bot', openRunDialog],
      ['Run fast checks', 'play', () => runChecks('fast')],
      ['Run all checks', 'fast-forward', () => runChecks('all')],
      ['AI review of the changes', 'sparkles', runReview],
      [`Fix loop: turn ${$('#fixloop').checked ? 'off' : 'on'}`, 'repeat', () => { $('#fixloop').checked = !$('#fixloop').checked; $('#fixloop').dispatchEvent(new Event('change')); }],
      [`Auto checks: turn ${state.autoCheck ? 'off' : 'on'}`, 'check-check', () => { $('#auto').checked = !$('#auto').checked; $('#auto').dispatchEvent(new Event('change')); }],
      ['Show: Files', 'files', () => setSideTab('files')],
      ['Show: Search in project', 'search', focusSearch, 'focusSearch'],
      ['Show: Agents', 'bot', () => setSideTab('agents')],
      ['Show: Changes', 'git-compare', () => setSideTab('changes')],
      ['Show: History (commit graph)', 'history', () => setSideTab('history')],
      ['Review: comment on the current line…', 'message-square-plus', commentAtCursor],
      ['Review: send comments to the agent', 'send', sendComments],
      ['Markdown: toggle preview', 'eye', toggleMarkdownPreview],
      ['Terminal: find in scrollback', 'search', () => { const t = currentTerminal(); if (t) openTermFind(t); else setStatus('Open a terminal tab first.'); }],
      ['Folders: detect source and test folders', 'folder', detectFolders],
      ['Show: Scripts', 'scroll-text', () => setSideTab('scripts')],
      ['Show: Todos (TODO/FIXME/HACK/XXX comments)', 'list-checks', () => showBottom('todos')],
      ['Show: Bookmarks', 'bookmark', () => showBottom('bookmarks')],
      ['Toggle bookmark', 'bookmark', () => toggleBookmarkAtCursor(editor)],
      ['Go to next bookmark', 'chevron-down', () => jumpBookmark(1)],
      ['Go to previous bookmark', 'chevron-up', () => jumpBookmark(-1)],
      ['New HTTP request', 'globe', () => openRestTab()],
      ['Snippet: save selection as snippet…', 'braces', () => saveSelectionAsSnippet()],
      ['View: split editor right', 'columns-2', () => splitRight()],
      ['View: close split editor', 'x', () => closeSplit()],
      [`Minimap: turn ${minimapOn() ? 'off' : 'on'}`, 'map', () => toggleMinimap()],
      [`Zen mode: turn ${state.zen ? 'off' : 'on'}`, 'square', () => toggleZen()],
      ['Tab: pin/unpin active tab', 'pin', () => { const t = activeTab(); if (t) toggleTabPin(t.id); else setStatus('Open a tab first.'); }],
      ['Tab: close other tabs', 'x', () => { const t = activeTab(); if (t) closeOtherTabs(t.id); }],
      ['Tab: close all tabs', 'x', () => closeAllTabs()],
      ['Spring: endpoints and beans…', 'globe', openSpringOverview],
      ['Git: stash changes…', 'archive', () => { setSideTab('history'); const m = window.prompt('Stash message (optional):', ''); if (m !== null) stashAction('push', m); }],
      [`Git: line blame ${state.blame.on ? 'off' : 'on'}`, 'user', toggleBlame],
      ['Git: stage the change at the cursor', 'plus', () => stageChangeAtCursor(false)],
      ['Git: unstage the change at the cursor', 'minus', () => stageChangeAtCursor(true)],
      ['Git: checkpoint now', 'tag', () => makeCheckpoint('manual')],
      ['Test: run the test at the cursor', 'flask-conical', runTestAtCursor],
      ['Test: run all tests in this file', 'flask-conical', () => { if (tab && tab.kind === 'file') runTestFor(tab.rel, null, true); else setStatus('Open a test file first.'); }],
      ['Debug this file (Python, Go, Dart)', 'octagon-pause', () => { if (tab && tab.kind === 'file' && canRealDebug(tab.rel)) startDebugging(tab.rel); else setStatus('Debugging is wired up for Python, Go and Dart right now (open one of those first).'); }],
      ['Debug: stop', 'square', () => stopDebugging()],
      [`Switch theme (now: ${themeLabel(themeSetting)})`, themeIcon(themeSetting), () => { const names = allThemeIds(); setThemeSetting(names[(names.indexOf(themeSetting) + 1) % names.length]); }],
      ['Font size: larger', 'plus', () => changeFontSize(1)],
      ['Font size: smaller', 'minus', () => changeFontSize(-1)],
      ['Font size: reset', 'refresh-cw', () => changeFontSize(0)],
      ['Save file', 'check', saveActive, 'saveFile'],
      ['Refresh everything', 'refresh-cw', () => $('#btn-refresh').click()],
      ['Local history of this file…', 'history', () => { const t = activeTab(); openLocalHistory(t && t.kind === 'file' ? t.rel : null, t && t.root); }],
      ['Setup & health: what works, what needs fixing (Claude, local models, Docker, Jev…)', 'stethoscope', openDoctor],
      ['Welcome walkthrough: pick an agent and try a first run', 'sparkles', () => openWalkthrough(0)],
      ['Start a workflow (chained agent steps)…', 'workflow', openWorkflows],
      ['Workflow self-check (does chaining work with this agent?)', 'workflow', openWorkflowSelfCheck],
      ['Show the debug log (what the agents and workflows are doing)', 'bug', () => showDebug()],
      ['Work items (Azure Boards or Jira): start an agent run from one…', 'workflow', () => openWorkItems((text, item) => openRunDialog({ task: text, name: `${item.ref || `AB#${item.id}`} ${item.title}`.slice(0, 60) }), null)],
      ['Agent skills (IDE and project level)…', 'package', openSkills],
      ['Agent configuration (MCP servers, skills, agents, hooks)…', 'link', openAgentConfig],
      ['Check for updates…', 'refresh-cw', openUpdates],
      ['Capture real traffic (hooks, telemetry, model replies, ACP): turn on or off', 'bug', async () => { const st = await api.capture.toggle(); setStatus(st.enabled ? `Capture is ON. Use your agents as usual, then run “Capture: show the files”. Only shapes are kept: every text is replaced by its length.` : 'Capture is off.'); }],
      ['Capture: show the files (to send them)…', 'bug', async () => { const r = await api.capture.bundle(); setStatus(r.file ? `One file with everything captured: ${r.file}. Nothing readable is in it, only shapes (${r.status.total} records).` : 'Nothing captured yet. Turn capture on first, then use an agent.'); }],
      ['Jev (TypeSafe AI): recognise the kind of a task with the Jev model, on or off', 'bug', async () => {
        const st = await api.jev.toggle();
        setStatus(st.enabled ? `Jev is ON for the scorecard: the task text (nothing else) is sent to TypeSafe’s API.${st.hasKey ? '' : ` Set ${st.keyEnv} in the environment and restart Bazinga; until then the keyword rules are used.`}` : 'Jev is off: task kinds are recognised by keyword rules on this machine.');
      }],
      ...(state.project && state.project.config && state.project.config.copilot && state.project.config.copilot.enabled ? [['GitHub Copilot: open my usage (used so far, reset date)', 'external-link', () => api.openExternal('https://github.com/settings/billing')]] : []),
      ['While you were away: what happened to your agent runs', 'history', () => openAway()],
      ['Undo a merged run (adds a revert commit)', 'undo-2', openUndo],
      ['What’s new in Bazinga (changes since you last looked)', 'sparkles', openWhatsNew],
      ['Open this file in VS Code', 'external-link', () => openInOtherEditor('vscode')],
      ['Open this file in IntelliJ IDEA', 'external-link', () => openInOtherEditor('idea')],
      ['Open this file in the other editor (Java: IntelliJ, else VS Code)', 'external-link', () => openInOtherEditor()],
      ['Usage & insights: plan limits, cost, model health, dependencies, Sonar, Actuator', 'timer', openInsights],
      [`Coverage: ${coverage.on ? 'hide' : 'show'} marks in the editor`, 'flask-conical', toggleCoverage],
      ['Claude Code compatibility: version, unknown hook fields…', 'bug', async () => {
        const st = await api.drift.status();
        if (window.confirm(`${st.text}\n\nBazinga reads Claude Code’s hooks, telemetry and transcripts, which can change between versions.\n\nPress OK to confirm that the current version works for you (later versions will then show a notice), Cancel to leave it.`)) { await api.drift.confirm(); setStatus('Claude Code version confirmed. Newer versions will show a notice.'); }
      }],
      ['Capture: delete the captured files', 'bug', async () => { await api.capture.clear(); setStatus('Capture files deleted.'); }],
      ['Settings…', 'settings', openSettings],
    ];
    const km = resolvedKeymap();
    return cmds.map(([title, icon, run, bindId]) => ({ title, icon, run, keys: bindId ? chordLabel(km[bindId]) : undefined }));
  }

  async function runTestAtCursor() {
    const tab = activeTab();
    if (!tab || tab.kind !== 'file') { setStatus('Open a test file and put the cursor in a test.'); return; }
    const m = state.models.get(tab.rel);
    const tests = await api.tests.find(tab.rel, m.model.getValue());
    const line = editor.getPosition().lineNumber;
    const t = [...tests].filter((x) => x.kind === 'test' && x.line <= line).pop() || tests.find((x) => x.kind === 'test');
    if (!t) { setStatus('No test found in this file.'); return; }
    runTestFor(tab.rel, t, false);
  }

  function openPalette() {
    state.quick.mode = 'commands';
    $('#quickopen').classList.remove('hidden');
    const input = $('#qo-input');
    input.value = '';
    input.placeholder = 'Type a command…';
    input.focus();
    state.quick.sel = 0;
    renderQuick();
  }


  // ---------------------------------------------------------------- debug log: what the workflow and the agents are doing
  /** Writes a line to the debug log (kept in the main process, shown in the Debug tab, also saved to a file). Never throws. */
  const dbg = (source, text) => { try { const r = api.debug && api.debug.log(source, String(text)); if (r && r.catch) r.catch(() => {}); } catch { /* logging only */ } };
  state.debug = { open: false, last: 0, items: [], filter: '', follow: true, timer: null };
  const DEBUG_FILTERS = [['', 'All'], ['workflow', 'Workflow'], ['agent', 'Agent'], ['idle', 'Idle'], ['prompt', 'Prompt'], ['fixloop', 'Fix loop'], ['model', 'Model'], ['pty', 'Terminal'], ['hook', 'Hooks']];
  const debugClock = (ms) => { const d = new Date(ms); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`; };
  const debugVisible = () => state.debug.items.filter((e) => !state.debug.filter || e.source === state.debug.filter);
  const debugText = () => debugVisible().map((e) => `${debugClock(e.at)} [${e.source}] ${e.text}`).join('\n');
  function renderDebug() {
    const host = $('#debug');
    if (!host) return;
    let body = host.querySelector('.dbg-body');
    if (!body) {
      const filters = el('div', { class: 'dbg-filters' }, ...DEBUG_FILTERS.map(([k, label]) => el('button', { class: `dbg-f${state.debug.filter === k ? ' active' : ''}`, 'data-k': k, text: label, onclick: () => { state.debug.filter = k; host.querySelectorAll('.dbg-f').forEach((b) => b.classList.toggle('active', b.dataset.k === k)); renderDebug(); } })));
      const bar = el('div', { class: 'dbg-bar' }, filters,
        el('button', { id: 'dbg-copy', title: 'Copy what is shown to the clipboard', onclick: () => { api.copy(debugText()); setStatus('Debug log copied.'); } }, ic('clipboard-copy'), 'Copy'),
        el('button', { id: 'dbg-save', title: 'Save the whole log to a file', onclick: async () => { const f = await api.debug.save(); if (f) setStatus(`Debug log saved to ${f}`); } }, ic('download'), 'Save…'),
        el('button', { id: 'dbg-clear', onclick: async () => { await api.debug.clear(); state.debug.items = []; renderDebug(); } }, ic('trash-2'), 'Clear'));
      body = el('div', { class: 'dbg-body', onscroll: () => { state.debug.follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 8; } });
      host.replaceChildren(bar, body);
    }
    const rows = debugVisible();
    body.replaceChildren(...(rows.length ? rows.map((e) => el('div', { class: `dbg-row dbg-${e.source}` }, el('span', { class: 'dbg-t', text: debugClock(e.at) }), el('span', { class: 'dbg-s', text: e.source }), el('span', { class: 'dbg-x', text: e.text }))) : [el('div', { class: 'muted dbg-empty', text: 'Nothing logged yet. Start a workflow or an agent and the steps show up here.' })]));
    if (state.debug.follow) body.scrollTop = body.scrollHeight;
  }
  async function pollDebug() {
    try {
      const got = await api.debug.get(state.debug.last);
      if (Array.isArray(got) && got.length) { state.debug.items.push(...got); state.debug.last = got[got.length - 1].n; if (state.debug.items.length > 3000) state.debug.items.splice(0, state.debug.items.length - 3000); }
    } catch { /* ignored */ }
    if (state.bottom === 'debug') renderDebug();
  }
  function showDebug() {
    state.debug.open = true;
    if (!state.debug.timer) state.debug.timer = setInterval(() => { if (state.bottom === 'debug') pollDebug(); }, 1000);
    showBottom('debug');
  }
  function closeDebug() {
    state.debug.open = false;
    if (state.debug.timer) { clearInterval(state.debug.timer); state.debug.timer = null; }
    if (state.bottom === 'debug') showBottom('problems'); else renderBottomTabs();
  }

  // ---------------------------------------------------------------- real debugger (breakpoints, step, call stack, variables)
  // Python (debugpy), Go (dlv dap) and Dart (dart debug_adapter) - see core/dap.js's header comment for what
  // was verified against a real debugpy.adapter session versus what's written but unverified (Go/Dart need
  // their own toolchains, not installed here). Other languages keep the existing "Debug" lens (Settings → a
  // Debug lens), which starts the test waiting for your own IDE's debugger to attach instead - the right fit
  // for compiled languages (C#/F#/Rust/...), which need a build step before anything is launchable.
  state.debugger = { open: false, status: 'idle', rel: null, breakpoints: new Map(), threadId: null, frames: [], currentFrameId: null, scopes: new Map(), variables: new Map(), expanded: new Set(), output: [] };
  const canRealDebug = (rel) => /\.(py|go|dart)$/i.test(String(rel || ''));
  const bpSet = (rel) => { let s = state.debugger.breakpoints.get(rel); if (!s) { s = new Set(); state.debugger.breakpoints.set(rel, s); } return s; };
  const bpDecoIds = new Map(); // rel -> decoration ids, so a repaint replaces rather than piles up
  function paintBreakpoints(rel) {
    const m = state.models.get(rel);
    if (!m) return;
    const lines = [...bpSet(rel)].sort((a, b) => a - b);
    bpDecoIds.set(rel, m.model.deltaDecorations(bpDecoIds.get(rel) || [], lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: false, glyphMarginClassName: 'bp-dot', glyphMarginHoverMessage: { value: 'Breakpoint (click the gutter to remove)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }))));
  }
  function toggleBreakpoint(rel, line) {
    const set = bpSet(rel);
    if (set.has(line)) set.delete(line); else set.add(line);
    paintBreakpoints(rel);
    if (state.debugger.status !== 'idle' && state.debugger.status !== 'terminated' && state.debugger.rel === rel) api.dap.setBreakpoints({ rel, lines: [...set] });
  }

  // ---------------------------------------------------------------- bookmarks (local to this machine, via session.json - not git-shared, same as open tabs/terminals)
  const bmSet = (rel) => { let s = state.bookmarks.get(rel); if (!s) { s = new Set(); state.bookmarks.set(rel, s); } return s; };
  const bmDecoIds = new Map(); // rel -> decoration ids, so a repaint replaces rather than piles up
  function paintBookmarks(rel) {
    const m = state.models.get(rel);
    if (!m) return;
    const lines = [...bmSet(rel)].sort((a, b) => a - b);
    bmDecoIds.set(rel, m.model.deltaDecorations(bmDecoIds.get(rel) || [], lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: false, glyphMarginClassName: 'bm-dot', glyphMarginHoverMessage: { value: 'Bookmark (click the gutter, or Toggle Bookmark, to remove)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }))));
  }
  function toggleBookmark(rel, line) {
    const set = bmSet(rel);
    if (set.has(line)) { set.delete(line); if (!set.size) state.bookmarks.delete(rel); } else set.add(line);
    paintBookmarks(rel);
    renderBookmarks();
    scheduleSessionSave();
  }
  function toggleBookmarkAtCursor(ed) {
    const t = activeTab();
    const pos = ed.getPosition();
    if (t && t.kind === 'file' && pos) toggleBookmark(t.rel, pos.lineNumber);
  }
  function allBookmarks() {
    const out = [];
    for (const [rel, lines] of state.bookmarks) for (const line of [...lines].sort((a, b) => a - b)) out.push({ rel, line });
    out.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel)));
    return out;
  }
  function renderBookmarks() {
    const host = $('#bookmarks');
    const list = allBookmarks();
    const head = el('div', { class: 'p-head' },
      el('span', { class: 'p-summary', text: `${list.length} bookmark${list.length === 1 ? '' : 's'}` }),
      el('span', { class: 'spacer' }),
      el('button', { title: 'Remove every bookmark', onclick: () => {
        const rels = [...state.bookmarks.keys()];
        state.bookmarks.clear();
        for (const rel of rels) paintBookmarksIfOpen(rel);
        renderBookmarks();
        scheduleSessionSave();
      } }, ic('trash-2'), 'Clear all'));
    const body = el('div');
    let lastFile;
    for (const b of list) {
      if (b.rel !== lastFile) { body.append(el('div', { class: 'p-file', text: b.rel })); lastFile = b.rel; }
      const m = state.models.get(b.rel);
      const preview = m ? m.model.getLineContent(b.line).trim() : '';
      body.append(el('div', { class: 'finding', onclick: () => openFile(b.rel, b.line) },
        el('span', { class: 'loc', text: `${b.line}` }),
        el('span', { text: preview || b.rel })));
    }
    if (!list.length) body.append(el('div', { class: 'empty', text: 'No bookmarks yet. Click a line’s gutter (on a file with no real debugger), or use "Toggle bookmark" from the editor’s right-click menu.' }));
    host.replaceChildren(head, body);
    renderBottomTabs();
  }
  function paintBookmarksIfOpen(rel) { if (state.models.has(rel)) paintBookmarks(rel); }
  function jumpBookmark(dir) {
    const list = allBookmarks();
    if (!list.length) { setStatus('No bookmarks yet.'); return; }
    const t = activeTab();
    const here = t && t.kind === 'file' ? list.findIndex((b) => b.rel === t.rel && b.line === (editor.getPosition() || {}).lineNumber) : -1;
    const idx = here >= 0 ? (here + dir + list.length) % list.length : (dir > 0 ? 0 : list.length - 1);
    const b = list[idx];
    openFile(b.rel, b.line);
  }

  // ---------------------------------------------------------------- breadcrumbs (path segments + symbol-containment chain above the editor)
  const breadcrumbSymbols = new Map(); // rel -> flat [{name, kind, line, endLine}], from the same api.symbols.info() the usages/blame lenses use
  async function loadBreadcrumbSymbols(rel) {
    const m = state.models.get(rel);
    if (!m) return;
    let res;
    try { res = await api.symbols.info(m.root || state.project.root, rel, m.model.getValue(), { dirty: m.dirty }); } catch { return; }
    if (!res || res.error) return;
    breadcrumbSymbols.set(rel, res.symbols.map((s) => ({ name: s.name, kind: s.kind, line: s.line, endLine: s.endLine || s.line })));
    const t = activeTab();
    if (t && t.kind === 'file' && t.rel === rel) {
      renderBreadcrumbs();
      if (state.bottom === 'outline') renderOutline();
    }
  }
  // immediate children of `parent` (or top-level symbols when null) - derived purely from each symbol's own
  // [line, endLine] range, with no parent pointers needed: a child is any symbol inside parent's range that
  // isn't itself inside some other, smaller symbol that's also inside parent's range.
  function symbolChildren(syms, parent) {
    const within = (s, box) => s.line >= box.line && s.endLine <= box.endLine;
    const candidates = syms.filter((s) => s !== parent && (!parent || within(s, parent)));
    return candidates.filter((s) => !candidates.some((other) => other !== s && within(s, other) && (other.endLine - other.line) < (s.endLine - s.line)));
  }
  function symbolChainAt(syms, line) {
    const chain = [];
    let parent = null;
    for (;;) {
      const kids = symbolChildren(syms, parent).filter((s) => line >= s.line && line <= s.endLine);
      if (!kids.length) break;
      const next = kids.sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
      chain.push(next);
      parent = next;
    }
    return chain;
  }
  async function pathSiblingItems(dirRel, root = state.project && state.project.root) {
    let entries; try { entries = await api.fs.list(root, dirRel); } catch { return []; }
    return (entries || []).map((e) => ({ label: e.name, icon: e.dir ? 'folder' : 'file', rel: e.rel, dir: !!e.dir }));
  }
  function renderBreadcrumbs() {
    const host = $('#breadcrumbs');
    if (!host) return;
    const t = activeTab();
    if (!t || t.kind !== 'file') { host.replaceChildren(); return; }
    const parts = t.rel.split('/');
    const segs = [];
    parts.forEach((part, i) => {
      const dirRel = parts.slice(0, i).join('/');
      const isFile = i === parts.length - 1;
      segs.push(el('span', { class: 'bc-seg', onclick: async (e) => {
        const entries = await pathSiblingItems(dirRel, t.root);
        if (entries.length > 1) popupMenu(e.clientX, e.clientY, entries.map((it) => ({ label: it.label, onclick: () => { if (!it.dir) openFile(it.rel, undefined, undefined, t.root); } })));
      } }, ic(isFile ? 'file-code' : 'folder', 'bc-ico'), part));
    });
    const syms = breadcrumbSymbols.get(t.rel) || [];
    const pos = editor.getPosition();
    const chain = pos ? symbolChainAt(syms, pos.lineNumber) : [];
    let parent = null;
    for (const s of chain) {
      const atLevel = parent;
      segs.push(el('span', { class: 'bc-seg bc-sym', onclick: (e) => {
        const siblings = symbolChildren(syms, atLevel).sort((a, b) => a.line - b.line);
        if (siblings.length > 1) popupMenu(e.clientX, e.clientY, siblings.map((sib) => ({ label: sib.name, onclick: () => openFile(t.rel, sib.line, undefined, t.root) })));
      } }, ic(SYMBOL_ICON[s.kind] || 'square-function', 'bc-ico'), s.name));
      parent = s;
    }
    host.replaceChildren(...segs.flatMap((s, i) => (i ? [el('span', { class: 'bc-sep' }, ic('chevron-right')), s] : [s])));
  }

  // ---------------------------------------------------------------- outline (bottom panel: the active file's symbol tree, same data breadcrumbs uses)
  function renderOutline() {
    const host = $('#outline');
    if (!host) return;
    const t = activeTab();
    if (!t || t.kind !== 'file') { host.replaceChildren(el('div', { class: 'empty', text: 'Open a file to see its outline.' })); return; }
    const syms = breadcrumbSymbols.get(t.rel) || [];
    const rows = [];
    const walk = (parent, depth) => {
      for (const s of symbolChildren(syms, parent).sort((a, b) => a.line - b.line)) {
        rows.push(el('div', { class: 'finding', style: `padding-left:${18 + depth * 14}px`, onclick: () => openFile(t.rel, s.line) },
          ic(SYMBOL_ICON[s.kind] || 'square-function', 'qo-ico'), el('span', { text: s.name })));
        walk(s, depth + 1);
      }
    };
    walk(null, 0);
    host.replaceChildren(
      el('div', { class: 'p-head' }, el('span', { class: 'p-summary', text: `${rows.length} symbol${rows.length === 1 ? '' : 's'}` })),
      el('div', {}, ...(rows.length ? rows : [el('div', { class: 'empty', text: 'No symbols found in this file.' })])));
  }

  // ---------------------------------------------------------------- split pane (a second, plain Monaco view for side-by-side reference - not a second tab group; scoped-down v1)
  async function openInSplit(rel, root = state.project && state.project.root) {
    const m = await ensureModel(rel, root);
    if (!m || m.unsupported) { setStatus(m && m.unsupported ? m.unsupported : `Could not open ${rel}`); return; }
    splitRel = rel;
    editor2.setModel(m.model);
    $('#editor2-pane').classList.remove('hidden');
    $('#editor2-title').textContent = rel;
  }
  function splitRight() {
    const t = activeTab();
    if (!t || t.kind !== 'file') { setStatus('Open a file first.'); return; }
    openInSplit(t.rel, t.root);
  }
  function closeSplit() {
    const rel = splitRel;
    splitRel = null;
    editor2.setModel(null);
    $('#editor2-pane').classList.add('hidden');
    if (rel && !state.tabs.some((t) => t.rel === rel && !t.ro)) {
      const m = state.models.get(rel);
      if (m) { dropComments(rel); m.model.dispose(); state.models.delete(rel); }
    }
  }

  let currentLineDeco = { rel: null, ids: [] };
  function clearCurrentLine() {
    if (currentLineDeco.rel) { const m = state.models.get(currentLineDeco.rel); if (m) m.model.deltaDecorations(currentLineDeco.ids, []); }
    currentLineDeco = { rel: null, ids: [] };
  }
  async function paintCurrentLine(rel, line) {
    clearCurrentLine();
    await ensureModel(rel);
    const m = state.models.get(rel);
    if (!m) return;
    currentLineDeco = { rel, ids: m.model.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'debug-current-line', glyphMarginClassName: 'debug-current-arrow' } }]) };
    openFile(rel, line);
  }
  const absToRel = (abs) => {
    const root = state.project && state.project.root; if (!root || !abs) return null;
    const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
    const r = norm(root).toLowerCase(); const a = norm(abs);
    return a.toLowerCase().startsWith(`${r}/`) ? a.slice(r.length + 1) : null;
  };
  function closeDebugger() {
    state.debugger.open = false;
    if (state.bottom === 'debugger') showBottom('problems'); else renderBottomTabs();
  }
  async function stopDebugging() {
    await api.dap.stop();
    state.debugger.status = 'idle'; state.debugger.threadId = null; state.debugger.frames = []; state.debugger.currentFrameId = null;
    state.debugger.scopes = new Map(); state.debugger.variables = new Map(); state.debugger.expanded = new Set();
    clearCurrentLine();
    renderDebuggerPanel();
  }
  async function startDebugging(rel) {
    if (!canRealDebug(rel)) { setStatus('Debugging is wired up for Python, Go and Dart right now.'); return; }
    if (state.debugger.status !== 'idle' && state.debugger.status !== 'terminated') await stopDebugging();
    state.debugger.rel = rel; state.debugger.status = 'starting'; state.debugger.open = true; state.debugger.output = [];
    showBottom('debugger');
    const started = await api.dap.start({ rel });
    if (started.error) { setStatus(started.error); state.debugger.status = 'idle'; renderDebuggerPanel(); return; }
    const bpRes = await api.dap.setBreakpoints({ rel, lines: [...bpSet(rel)] });
    if (!bpRes.error) for (const b of bpRes.breakpoints || []) if (!b.verified) setStatus(`Breakpoint at ${rel}:${b.line} could not be verified${b.message ? `: ${b.message}` : ''}.`);
    await api.dap.configurationDone();
    renderDebuggerPanel();
  }
  async function refreshStack() {
    const r = await api.dap.stackTrace(state.debugger.threadId);
    state.debugger.frames = r.frames || [];
    state.debugger.scopes = new Map(); state.debugger.variables = new Map(); state.debugger.expanded = new Set();
    await focusFrame(state.debugger.frames[0]);
  }
  async function focusFrame(frame) {
    if (!frame) { renderDebuggerPanel(); return; }
    state.debugger.currentFrameId = frame.id;
    const rel = frame.source && frame.source.path ? absToRel(frame.source.path) : null;
    if (rel) await paintCurrentLine(rel, frame.line); else clearCurrentLine();
    const sc = await api.dap.scopes(frame.id);
    state.debugger.scopes.set(frame.id, sc.scopes || []);
    for (const s of sc.scopes || []) { if (s.expensive) continue; const v = await api.dap.variables(s.variablesReference); state.debugger.variables.set(s.variablesReference, v.variables || []); }
    renderDebuggerPanel();
  }
  async function toggleVariable(ref) {
    if (state.debugger.expanded.has(ref)) state.debugger.expanded.delete(ref);
    else {
      state.debugger.expanded.add(ref);
      if (!state.debugger.variables.has(ref)) { const v = await api.dap.variables(ref); state.debugger.variables.set(ref, v.variables || []); }
    }
    renderDebuggerPanel();
  }
  const varRows = (ref, depth) => (state.debugger.variables.get(ref) || []).flatMap((v) => {
    const expandable = v.variablesReference > 0;
    const row = el('div', { class: 'dbgr-var', style: `padding-left:${depth * 16}px` },
      expandable ? el('span', { class: 'dbgr-caret', onclick: () => toggleVariable(v.variablesReference) }, ic(state.debugger.expanded.has(v.variablesReference) ? 'chevron-down' : 'chevron-right')) : el('span', { class: 'dbgr-caret' }),
      el('b', { text: v.name }), el('span', { class: 'muted', text: ' = ' }), el('span', { text: v.value }), v.type ? el('span', { class: 'muted', text: ` (${v.type})` }) : null);
    return expandable && state.debugger.expanded.has(v.variablesReference) ? [row, ...varRows(v.variablesReference, depth + 1)] : [row];
  });
  function renderDebuggerPanel() {
    const host = $('#debugger');
    if (!host) return;
    const d = state.debugger;
    const running = d.status === 'running';
    const stopped = d.status === 'stopped';
    const frame = d.frames.find((f) => f.id === d.currentFrameId);
    const scopesHere = frame ? (d.scopes.get(frame.id) || []) : [];
    fill(host,
      el('div', { class: 'dbgr-toolbar' },
        el('span', { class: `chip ${stopped ? 'danger' : running ? 'ok' : 'ghost'}`, text: d.status }),
        el('button', { class: 'icon', title: 'Continue', disabled: !stopped, onclick: () => api.dap.continue(d.threadId) }, ic('play')),
        el('button', { class: 'icon', title: 'Step over', disabled: !stopped, onclick: () => api.dap.next(d.threadId) }, ic('step-forward')),
        el('button', { class: 'icon', title: 'Step into', disabled: !stopped, onclick: () => api.dap.stepIn(d.threadId) }, ic('corner-down-right')),
        el('button', { class: 'icon', title: 'Step out', disabled: !stopped, onclick: () => api.dap.stepOut(d.threadId) }, ic('skip-forward')),
        el('button', { class: 'icon', title: 'Pause', disabled: !running, onclick: () => api.dap.pause(d.threadId) }, ic('pause')),
        el('button', { class: 'icon danger', title: 'Stop', disabled: d.status === 'idle', onclick: () => stopDebugging() }, ic('square'))),
      el('div', { class: 'dbgr-body' },
        el('div', { class: 'dbgr-col' },
          el('div', { class: 'sk-head' }, ic('layers'), el('span', { text: 'Call stack' })),
          ...(d.frames.length ? d.frames.map((f) => el('div', { class: `dbgr-frame${f.id === d.currentFrameId ? ' sel' : ''}`, onclick: () => focusFrame(f) },
            el('b', { text: f.name }), el('span', { class: 'muted', text: f.source && f.source.path ? ` ${(absToRel(f.source.path) || f.source.path)}:${f.line}` : '' })))
            : [el('div', { class: 'muted', text: stopped ? 'No frames.' : running ? 'Running…' : d.status === 'terminated' ? 'Finished.' : 'Not running.' })])),
        el('div', { class: 'dbgr-col' },
          el('div', { class: 'sk-head' }, ic('variable'), el('span', { text: 'Variables' })),
          ...(scopesHere.length ? scopesHere.flatMap((s) => [el('div', { class: 'dbgr-scope', text: s.name }), ...varRows(s.variablesReference, 0)]) : [el('div', { class: 'muted', text: 'Stop at a breakpoint to see variables.' })])),
        el('div', { class: 'dbgr-col' },
          el('div', { class: 'sk-head' }, ic('square-terminal'), el('span', { text: 'Output' })),
          el('pre', { class: 'dbgr-output', text: d.output.slice(-200).join('') }))));
  }
  function handleDapEvent(event, body) {
    const d = state.debugger;
    if (event === 'stopped') { d.status = 'stopped'; d.threadId = body.threadId; refreshStack(); return; }
    if (event === 'continued') { d.status = 'running'; clearCurrentLine(); renderDebuggerPanel(); return; }
    if (event === 'terminated') { d.status = 'terminated'; d.frames = []; d.currentFrameId = null; clearCurrentLine(); renderDebuggerPanel(); return; }
    if (event === 'output' && body && typeof body.output === 'string') { d.output.push(body.output); if (d.output.length > 400) d.output.splice(0, d.output.length - 400); renderDebuggerPanel(); }
  }

  // ---------------------------------------------------------------- bottom panel: problems, review, terminals
  function renderBottomTabs() {
    const bar = $('#bottom-tabs');
    const c = countOf(visibleFindings());
    const count = c.error + c.warning;
    const tabs = [el('div', { class: `btab${state.bottom === 'problems' ? ' active' : ''}`, onclick: () => showBottom('problems') },
      ic(count ? 'circle-alert' : 'circle-check', count ? 'bt-err' : 'bt-ok'), 'Problems', count ? el('span', { class: 'badge', text: `(${count})` }) : null)];
    if (state.review.used) {
      tabs.push(el('div', { class: `btab${state.bottom === 'review' ? ' active' : ''}`, onclick: () => showBottom('review') },
        ic('sparkles'), 'Review', state.review.running ? el('span', { class: 'badge', text: '…' }) : null));
    }
    tabs.push(el('div', { class: `btab${state.bottom === 'todos' ? ' active' : ''}`, onclick: () => showBottom('todos') },
      ic('list-checks'), 'Todos', state.todos.items.length ? el('span', { class: 'badge', text: `(${state.todos.items.length})` }) : null));
    { const bmCount = allBookmarks().length;
      tabs.push(el('div', { class: `btab${state.bottom === 'bookmarks' ? ' active' : ''}`, onclick: () => showBottom('bookmarks') },
        ic('bookmark'), 'Bookmarks', bmCount ? el('span', { class: 'badge', text: `(${bmCount})` }) : null)); }
    tabs.push(el('div', { class: `btab${state.bottom === 'outline' ? ' active' : ''}`, onclick: () => showBottom('outline') }, ic('list-tree'), 'Outline'));
    if (state.debug.open) tabs.push(el('div', { class: `btab${state.bottom === 'debug' ? ' active' : ''}`, onclick: () => showBottom('debug') }, ic('bug'), 'Debug', el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeDebug(); } }, ic('x'))));
    if (state.debugger.open) tabs.push(el('div', { class: `btab${state.bottom === 'debugger' ? ' active' : ''}`, onclick: () => showBottom('debugger') }, ic('octagon-pause'), 'Run & Debug', el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeDebugger(); } }, ic('x'))));
    for (const t of state.terms.values()) {
      tabs.push(el('div', { class: `btab${state.bottom === t.key ? ' active' : ''}${t.exited ? ' exited' : ''}`, onclick: () => showBottom(t.key) },
        ic(t.fix && (t.fix.state === 'fixing' || t.fix.state === 'checking') ? 'repeat' : 'terminal', t.fix && (t.fix.state === 'fixing' || t.fix.state === 'checking') ? 'spin' : ''), el('span', { text: t.title }),
        t.fix && t.fix.state === 'fixing' ? el('span', { class: 'badge', title: 'Fix loop round', text: `${t.fix.round}/${t.fix.maxRounds}` }) : null,
        t.prompt ? el('span', { class: 'badge warnbadge', title: t.prompt.text, text: 'approve?' }) : null,
        t.fix && t.fix.state === 'done' ? ic('check', 'bt-ok') : null,
        t.fix && (t.fix.state === 'stop' || t.fix.state === 'error') ? ic('triangle-alert', 'bt-err') : null,
        el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeTerminal(t.key); } }, ic('x'))));
    }
    bar.replaceChildren(...tabs);
  }

  function showBottom(key) {
    state.bottom = key;
    hideTermFindUnless(key);
    $('#problems').style.display = key === 'problems' ? 'block' : 'none';
    $('#review').style.display = key === 'review' ? 'block' : 'none';
    $('#todos').style.display = key === 'todos' ? 'block' : 'none';
    if (key === 'todos' && !state.todos.items.length && !state.todos.scanning) scanTodos();
    $('#bookmarks').style.display = key === 'bookmarks' ? 'block' : 'none';
    if (key === 'bookmarks') renderBookmarks();
    $('#outline').style.display = key === 'outline' ? 'block' : 'none';
    if (key === 'outline') renderOutline();
    $('#debug').style.display = key === 'debug' ? 'flex' : 'none';
    if (key === 'debug') pollDebug();
    $('#debugger').style.display = key === 'debugger' ? 'flex' : 'none';
    const isTerm = key !== 'problems' && key !== 'review' && key !== 'todos' && key !== 'bookmarks' && key !== 'outline' && key !== 'debug' && key !== 'debugger';
    $('#terms').style.display = isTerm ? 'block' : 'none';
    for (const t of state.terms.values()) t.container.classList.toggle('active', t.key === key);
    renderBottomTabs();
    const t = state.terms.get(key);
    if (t) { state.focusedTerm = key; requestAnimationFrame(() => { try { t.fit.fit(); } catch { /* hidden */ } t.term.focus(); }); }
  }

  function fitActive() {
    const t = state.terms.get(state.bottom);
    if (t) { try { t.fit.fit(); } catch { /* hidden */ } }
  }

  // ---------------------------------------------------------------- zen mode (hide everything but the editor)
  function toggleZen() {
    state.zen = !state.zen;
    document.body.classList.toggle('zen', state.zen);
    setStatus(state.zen ? 'Zen mode on - Esc, or run the command again, to leave it.' : 'Zen mode off.');
  }

  async function newTerminal({ title = 'Terminal', cwd, initialInput, env, inlineEnv, hostEnv, sandboxed = false, runId, watch = false, noEscalate = false, label, agent = null, persist = title === 'Terminal' } = {}) {
    if (!state.project || !state.project.root) { setStatus('Open a project first.'); return null; }
    const key = `t${++state.termSeq}`;
    const container = el('div', { class: 'term' });
    $('#terms').append(container);
    const term = new window.Terminal({
      fontFamily: MONO, fontSize: cfgNum('terminalFontSize', 13), cursorBlink: true, scrollback: scrollbackSetting(), allowProposedApi: true,
      theme: TERM_THEMES[resolvedTheme()],
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    const search = window.SearchAddon ? new window.SearchAddon.SearchAddon() : null;
    if (search) term.loadAddon(search);
    const entry = { startedAt: Date.now(), key, title, term, fit, search, container, id: null, exited: false, runId: runId || null, agent, persist, sandboxed, cwd: cwd || state.project.root };
    entry.atMention = /^\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(String(initialInput || '')); // Claude Code understands @file
    state.terms.set(key, entry);
    showBottom(key);
    term.open(container);
    try { fit.fit(); } catch { /* ignore */ }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      const mod = IS_MAC ? e.metaKey : e.ctrlKey; // Cmd+C/V on macOS; Ctrl+C stays the interrupt key there
      if (mod && k === 'c' && (term.hasSelection() || (e.shiftKey && !IS_MAC))) { api.copy(term.getSelection()); return false; }
      if (mod && k === 'f' && !e.shiftKey && !e.altKey && search) { openTermFind(entry); return false; }
      if (mod && k === 'v') return false; // let the browser paste event reach xterm (bracketed paste)
      return true;
    });

    // drop files (from the file tree or the OS) and paste screenshots: their paths go into the prompt
    const typePaths = async (paths) => {
      if (entry.id === null || entry.exited) return;
      const r = await api.drop.format(paths, { agent: !!entry.agent, at: !!entry.atMention });
      if (r.error || !r.text) { setStatus(r.error || 'Nothing to insert.'); return; }
      api.pty.write(entry.id, `\x1b[200~${r.text}\x1b[201~`);
      term.focus();
    };
    entry.typePaths = typePaths;
    container.addEventListener('dragover', (ev) => { const t = ev.dataTransfer && ev.dataTransfer.types; if (t && (t.includes('Files') || t.includes('application/x-bazinga-path'))) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; container.classList.add('drop-target'); } });
    container.addEventListener('dragleave', () => container.classList.remove('drop-target'));
    container.addEventListener('drop', (ev) => {
      container.classList.remove('drop-target');
      const dt = ev.dataTransfer; if (!dt) return;
      ev.preventDefault(); ev.stopPropagation();
      const inner = dt.getData('application/x-bazinga-path');
      const paths = inner ? inner.split('\n').filter(Boolean) : [...dt.files].map((f) => api.drop.pathOf(f)).filter(Boolean);
      if (paths.length) typePaths(paths);
    });
    container.addEventListener('paste', async (ev) => {
      const img = [...((ev.clipboardData && ev.clipboardData.files) || [])].find((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
      if (!img) return; // text paste: xterm handles it
      ev.preventDefault(); ev.stopPropagation();
      const buf = new Uint8Array(await img.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const saved = await api.drop.saveImage(btoa(bin), img.type.split('/')[1]);
      if (saved.error) { setStatus(saved.error); return; }
      await typePaths([saved.path]);
      setStatus('Pasted image saved; its path was typed into the prompt.');
    }, true);

    const res = await api.pty.create({ cols: term.cols, rows: term.rows, cwd, initialInput, env, inlineEnv, hostEnv, watch, noEscalate, label: label || title });
    if (res.error) {
      term.write(`\r\n\x1b[31m${res.error.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
      entry.exited = true;
      renderBottomTabs();
      return entry;
    }
    entry.id = res.id;
    term.onData((d) => { api.pty.write(res.id, d); if (entry.prompt) { entry.prompt = null; renderBottomTabs(); renderAgentsPane(); } });
    term.onResize(({ cols, rows }) => api.pty.resize(res.id, cols, rows));
    api.pty.resize(res.id, term.cols, term.rows);
    term.focus();
    scheduleSessionSave();
    return entry;
  }

  // ---------------------------------------------------------------- terminal scrollback search
  const termFind = { entry: null, caseSensitive: false };
  const FIND_DECO = { matchBackground: '#7a5c00', activeMatchBackground: '#d19a00', matchOverviewRuler: '#d19a00', activeMatchColorOverviewRuler: '#ffcc33' };
  function runTermFind(dir, fresh) {
    const e = termFind.entry; const q = $('#tf-q').value;
    if (!e || !e.search) return false;
    if (!q) { e.search.clearDecorations(); $('#tf-count').textContent = ''; $('#tf-q').classList.remove('bad'); return false; }
    const opts = { caseSensitive: termFind.caseSensitive, incremental: !!fresh, decorations: FIND_DECO };
    const found = dir < 0 ? e.search.findPrevious(q, opts) : e.search.findNext(q, opts);
    $('#tf-q').classList.toggle('bad', !found);
    if (!found) $('#tf-count').textContent = 'no match';
    return found;
  }
  function openTermFind(entry) {
    if (!entry || !entry.search) return;
    if (termFind.entry && termFind.entry !== entry && termFind.entry.search) termFind.entry.search.clearDecorations();
    termFind.entry = entry;
    if (!entry.findBound) {
      entry.findBound = true;
      entry.search.onDidChangeResults(({ resultIndex, resultCount }) => { if (termFind.entry === entry) $('#tf-count').textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : (resultIndex === -1 && !resultCount ? 'no match' : ''); });
    }
    const sel = entry.term.hasSelection() ? entry.term.getSelection().split('\n')[0].slice(0, 80) : '';
    $('#term-find').classList.remove('hidden');
    if (sel) $('#tf-q').value = sel;
    $('#tf-q').focus(); $('#tf-q').select();
    if ($('#tf-q').value) runTermFind(1, true);
  }
  function closeTermFind() {
    const e = termFind.entry;
    $('#term-find').classList.add('hidden');
    if (e && e.search) e.search.clearDecorations();
    termFind.entry = null;
    if (e) e.term.focus();
  }
  function hideTermFindUnless(key) { if (termFind.entry && termFind.entry.key !== key) { termFind.entry.search.clearDecorations(); termFind.entry = null; $('#term-find').classList.add('hidden'); } }
  function currentTerminal() { return [...state.terms.values()].find((t) => state.bottom === t.key) || null; }
  $('#tf-q').addEventListener('input', () => runTermFind(1, true));
  $('#tf-q').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); runTermFind(ev.shiftKey ? -1 : 1, false); } else if (ev.key === 'Escape') { ev.preventDefault(); closeTermFind(); } });
  $('#tf-next').addEventListener('click', () => runTermFind(1, false));
  $('#tf-prev').addEventListener('click', () => runTermFind(-1, false));
  $('#tf-close').addEventListener('click', closeTermFind);
  $('#tf-case').addEventListener('click', () => { termFind.caseSensitive = !termFind.caseSensitive; if (termFind.entry && termFind.entry.search) termFind.entry.search.clearDecorations(); $('#tf-case').classList.toggle('on', termFind.caseSensitive); runTermFind(1, true); });

  function closeTerminal(key) {
    if (termFind.entry && termFind.entry.key === key) { $('#term-find').classList.add('hidden'); termFind.entry = null; }
    const t = state.terms.get(key);
    if (!t) return;
    if (t.id !== null && !t.exited) api.pty.kill(t.id);
    t.term.dispose();
    t.container.remove();
    state.terms.delete(key);
    if (state.focusedTerm === key) state.focusedTerm = null;
    showBottom(state.bottom === key ? 'problems' : state.bottom);
    scheduleSessionSave();
  }

  api.pty.onData((id, data) => { for (const t of state.terms.values()) if (t.id === id) { t.term.write(data); t.lastData = Date.now(); if (t.prompt && Date.now() - t.prompt.at > 500) { t.prompt = null; renderBottomTabs(); renderAgentsPane(); } } });
  api.runs.onBudget((b) => { setStatus(`${b.name}: time budget used (${b.usedMin} of ${b.limitMin} min). The fix loop is stopped for it.`); refreshRuns(); });
  api.runs.onAutoMerged(async (e) => {
    setStatus(`Auto-merged “${e.name}” into ${e.into}: clean gates and a strong track record for this kind of task.`);
    for (const t of state.terms.values()) if (t.runId === e.id && t.id !== null && !t.exited) api.pty.kill(t.id);
    if (state.project && state.project.root === e.root) await switchRoot(e.mainRoot);
    await renderTree(); await refreshChanges(); await refreshRuns(); await loadProject();
  });
  api.onAgentPrompt((id, text) => { for (const t of state.terms.values()) if (t.id === id) fleetEvent(t, 'wait', `asks: ${String(text || 'permission').slice(0, 100)}`); dbg('prompt', `window heard: terminal ${id} asks: ${String(text || '').slice(0, 160)}`); for (const t of state.terms.values()) if (t.id === id) t.prompt = { text: text || 'The agent is asking for permission', at: Date.now() }; renderBottomTabs(); renderAgentsPane(); });
  api.pty.onExit((id, code) => {
    dbg('pty', `window heard: terminal ${id} exited (${code})`);
    for (const t of state.terms.values()) {
      if (t.id !== id) continue;
      t.exited = true; t.exitedAt = Date.now(); fleetEvent(t, 'exit', `exited (code ${code})`);
      if (t.printMode) t.signal = 'exit';
      if (t.printMode && t.wf) { dbg('workflow', `step ${t.wf.stepId}: the unattended agent ended with exit code ${code}`); setTimeout(() => wfOnIdle(t, { force: true, exitCode: code }).catch((e) => setStatus(`Workflow: ${e.message}`)), 0); }
      t.term.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`);
    }
    renderBottomTabs();
    if (typeof renderAgentsPane === 'function') renderAgentsPane();
  });
  new ResizeObserver(fitActive).observe($('#bottom-body'));

  function pasteIntoTerminal(text) {
    const t = state.terms.get(state.focusedTerm) || [...state.terms.values()].filter((x) => !x.exited).pop();
    if (!t) { api.copy(text); setStatus('No terminal open: copied to the clipboard instead.'); return; }
    t.term.paste(text);
    showBottom(t.key);
  }

  // ---------------------------------------------------------------- quality gates
  function findingsText() {
    const list = visibleFindings();
    if (!list.length) return '';
    const lines = list.map((f) => {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}${f.column ? `:${f.column}` : ''}` : '(project)';
      return `${loc} ${f.severity} [${f.tool}${f.rule ? ` ${f.rule}` : ''}] ${f.message}`;
    });
    return `The quality gate found these issues in the changed files. Please fix them:\n${lines.join('\n')}\n`;
  }

  function chip(run) {
    const label = run.status === 'skipped' ? `${run.name} (skipped: ${run.note})` : `${run.name}${run.count ? ` ${run.count}` : ''}`;
    return el('span', { class: `chip ${run.status}`, title: run.note || '', text: label });
  }

  function renderProblems() {
    const host = $('#problems');
    const head = el('div', { class: 'p-head' });
    const body = el('div');
    const r = state.lastResult;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    if (state.checksRunning) {
      head.append(el('b', { text: 'Running checks…' }), ...state.runProgress.done.map(chip));
      if (state.runProgress.running) head.append(el('span', { class: 'chip running', text: `${state.runProgress.running}…` }));
      head.append(el('button', { title: 'Stop the running tool', onclick: () => api.checks.cancel() }, ic('square'), 'Cancel'));
    } else if (!r) {
      head.append(el('span', { class: 'muted', text: 'No checks run yet. Use “Fast checks” or “All checks” in the top bar.' }));
    } else if (r.error) {
      head.append(el('span', { class: 'sev error', text: r.error }));
    } else {
      const visible = visibleFindings();
      const c = countOf(visible);
      head.append(el('span', { class: 'p-summary' },
        `ran ${(r.durationMs / 1000).toFixed(1)}s${r.cancelled ? ' · cancelled' : ''} · ${plural(c.error, 'error')}, ${plural(c.warning, 'warning')}, ${c.info} info`),
        el('span', { class: 'muted', text: `${r.files.length} changed file(s)` }),
        ...r.runs.map(chip));
      const legacy = hiddenLegacy();
      const only = el('input', { type: 'checkbox' });
      only.checked = state.onlyMine;
      only.addEventListener('change', () => { state.onlyMine = only.checked; renderProblems(); applyAllMarkers(); updateStatus(); scheduleSessionSave(); });
      head.append(el('label', { class: 'check', title: 'Hide issues on lines you did not change. Compile/type errors elsewhere are always shown.' },
        only, `Only my changes${legacy ? ` (${legacy} older hidden)` : ''}`));
      if (visible.length) {
        head.append(el('span', { class: 'spacer' }),
          el('button', { title: 'Copy the findings as a prompt for Claude/Copilot', onclick: async () => { await api.copy(findingsText()); setStatus('Findings copied: paste them into your agent.'); } }, ic('clipboard-copy'), 'Copy for agent'),
          el('button', { title: 'Paste the findings into the focused terminal (not submitted)', onclick: () => pasteIntoTerminal(findingsText()) }, ic('send'), 'Send to terminal'));
      }
      if (!r.files.length) body.append(el('div', { class: 'empty', text: 'No changed files, so nothing was checked. Make or review a change first.' }));
      else if (!visible.length) body.append(el('div', { class: 'empty', text: legacy && state.onlyMine ? 'No problems in your changes.' : 'All checks that could run passed.' }));
      let lastFile;
      for (const f of visible) {
        const file = f.file || '(project)';
        if (file !== lastFile) { body.append(el('div', { class: 'p-file', text: file })); lastFile = file; }
        body.append(el('div', { class: 'finding', onclick: () => f.file && openFile(f.file, f.line, f.column) },
          el('span', { class: `sev ${f.severity}`, title: f.severity }, ic(f.severity === 'error' ? 'circle-alert' : f.severity === 'warning' ? 'triangle-alert' : 'info')),
          el('span', { class: 'loc', text: f.line ? `${f.line}${f.column ? `:${f.column}` : ''}` : '' }),
          el('span', { text: f.message }),
          el('span', { class: 'src', text: `${f.tool}${f.rule ? ` · ${f.rule}` : ''}` })));
        if (f.detail) body.append(el('pre', { class: 'detail', text: f.detail }));
      }
    }
    host.replaceChildren(head, body);
    renderBottomTabs();
  }

  // ---------------------------------------------------------------- Todos (TODO/FIXME/HACK/XXX comments, project-wide)
  const TODO_TAG_ICON = { TODO: 'info', FIXME: 'warning', HACK: 'warning', XXX: 'error' };
  async function scanTodos() {
    if (!state.project || !state.project.root) return;
    state.todos.scanning = true;
    renderTodos();
    const res = await api.todos.scan();
    state.todos.scanning = false;
    if (res.error) { setStatus(res.error); state.todos.items = []; state.todos.truncated = false; }
    else { state.todos.items = res.items; state.todos.truncated = !!res.truncated; }
    renderTodos();
  }
  function renderTodos() {
    const host = $('#todos');
    const head = el('div', { class: 'p-head' });
    const body = el('div');
    if (state.todos.scanning) {
      head.append(el('span', { class: 'muted', text: 'Scanning…' }));
    } else {
      head.append(el('span', { class: 'p-summary', text: `${state.todos.items.length} TODO/FIXME/HACK/XXX comment(s)${state.todos.truncated ? ' (truncated)' : ''}` }),
        el('span', { class: 'spacer' }),
        el('button', { title: 'Scan the project again', onclick: scanTodos }, ic('refresh-cw'), 'Refresh'));
      const multiRootTodo = new Set(state.todos.items.map((t) => t.root)).size > 1;
      let lastFile; let lastTodoRoot;
      for (const t of state.todos.items) {
        if (multiRootTodo && t.root !== lastTodoRoot) { body.append(el('div', { class: 'c-title', text: rootName(t.root) })); lastTodoRoot = t.root; lastFile = null; }
        if (t.file !== lastFile) { body.append(el('div', { class: 'p-file', text: t.file })); lastFile = t.file; }
        body.append(el('div', { class: 'finding', onclick: () => openFile(t.file, t.line, t.column, t.root) },
          el('span', { class: `sev ${TODO_TAG_ICON[t.tag] || 'info'}`, title: t.tag }, ic(TODO_TAG_ICON[t.tag] === 'error' ? 'circle-alert' : TODO_TAG_ICON[t.tag] === 'warning' ? 'triangle-alert' : 'info')),
          el('span', { class: 'loc', text: `${t.line}` }),
          el('span', { text: `${t.tag}${t.text ? `: ${t.text}` : ''}` })));
      }
      if (!state.todos.items.length) body.append(el('div', { class: 'empty', text: 'No TODO, FIXME, HACK or XXX comments found.' }));
    }
    host.replaceChildren(head, body);
    renderBottomTabs();
  }

  // ---------------------------------------------------------------- snippets (.ide/snippets.yaml, offered as Monaco completions)
  let snippetsCache = [];
  async function loadSnippetsCache() { snippetsCache = state.project && state.project.root ? await api.snippets.list() : []; }
  async function saveSelectionAsSnippet() {
    const t = activeTab();
    if (!t || t.kind !== 'file') { setStatus('Open a file first.'); return; }
    const sel = editor.getSelection();
    const body = sel && !sel.isEmpty() ? editor.getModel().getValueInRange(sel) : '';
    if (!body.trim()) { setStatus('Select some code first.'); return; }
    const prefix = window.prompt('Snippet prefix (what you’ll type to trigger it):', '');
    if (!prefix) return;
    const description = window.prompt('Description (optional):', '') || '';
    const lang = editor.getModel().getLanguageId();
    const scoped = window.confirm(`Scope this snippet to ${lang} files only?\n\nOK = ${lang} only, Cancel = every language.`);
    const list = await api.snippets.list();
    list.push({ prefix, body, language: scoped ? lang : '', description });
    await api.snippets.save(list);
    snippetsCache = list;
    setStatus(`Snippet “${prefix}” saved.`);
  }

  // ---------------------------------------------------------------- REST client (a saved-request HTTP tab, Thunder-Client-style)
  let restTabSeq = 0;
  let restCollection = null; // cached .ide/requests.yaml, re-fetched after loadProject() or a save
  const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const REST_HEADER_NAMES = [
    'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control',
    'Connection', 'Content-Encoding', 'Content-Length', 'Content-Type', 'Cookie', 'Host',
    'If-Match', 'If-Modified-Since', 'If-None-Match', 'Origin', 'Pragma', 'Range', 'Referer',
    'User-Agent', 'X-API-Key', 'X-CSRF-Token', 'X-Forwarded-For', 'X-Request-Id', 'X-Requested-With',
  ];
  // not a real OAuth2 grant flow (no redirect listener, no token storage) - the same header-shorthand
  // Basic/Bearer/API-key auth every HTTP client offers, computed into the request by core/restclient.js.
  const REST_AUTH_TYPES = [['none', 'No auth'], ['basic', 'Basic'], ['bearer', 'Bearer token'], ['apiKey', 'API key']];
  async function restSaved() {
    if (!restCollection) restCollection = await api.rest.list();
    return restCollection;
  }
  // mirrors core/restclient.js's substitute() - only used client-side for the "copy as curl" text, since the
  // actual send() always resolves {{var}} tokens in the main process against the active environment.
  function restSubstitute(str, vars) {
    if (typeof str !== 'string' || !vars) return str;
    return str.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole));
  }
  // request/response bodies get a real Monaco model (syntax highlighting, JSON validation) instead of a
  // plain textarea/<pre> - only one REST tab is ever rendered into #rest at a time, so one tracked instance
  // of each is enough; every render disposes the previous one first so switching tabs/requests never leaks.
  let restBodyEditor = null;
  let restRespEditor = null;
  function disposeRestBodyEditor() { if (restBodyEditor) { restBodyEditor.editor.dispose(); restBodyEditor.model.dispose(); restBodyEditor = null; } }
  function disposeRestRespEditor() { if (restRespEditor) { restRespEditor.editor.dispose(); restRespEditor.model.dispose(); restRespEditor = null; } }
  function restHeaderValue(headers, name) {
    const h = (headers || []).find((x) => x.key && x.key.trim().toLowerCase() === name);
    return h ? h.value : null;
  }
  function restLangFromContentType(ct) {
    const v = String(ct || '').toLowerCase();
    if (!v) return null;
    if (v.includes('json')) return 'json';
    if (v.includes('html')) return 'html';
    if (v.includes('xml')) return 'xml';
    if (v.includes('javascript')) return 'javascript';
    if (v.includes('css')) return 'css';
    return v.includes('text/plain') ? 'plaintext' : null;
  }
  function restSniffLang(text) {
    const t = String(text || '').trim();
    if (/^[{[]/.test(t)) return 'json';
    if (/^</.test(t)) return 'xml';
    return 'plaintext';
  }
  function openRestTab(preset) {
    if (!state.project || !state.project.root) { setStatus('Open a project first.'); return; }
    const id = `rest:${++restTabSeq}`;
    const tab = {
      id, kind: 'rest',
      title: (preset && preset.name) || 'New request',
      method: (preset && preset.method) || 'GET',
      url: (preset && preset.url) || '',
      headers: preset && preset.headers ? Object.entries(preset.headers).map(([key, value]) => ({ key, value })) : [],
      body: (preset && preset.body) || '',
      auth: (preset && preset.auth) || { type: 'none' },
      folder: (preset && preset.folder) || '',
      response: null, sending: false,
    };
    state.tabs.push(tab);
    activateTab(id);
  }
  function renderRestResponse(box, tab) {
    disposeRestRespEditor();
    if (!tab.response) { fill(box); return; }
    const r = tab.response;
    if (!r.ok) { fill(box, el('div', { class: 'rest-error', text: `Error: ${r.error}` })); return; }
    const sevClass = r.status >= 200 && r.status < 300 ? 'ok' : r.status >= 400 ? 'danger' : 'info';
    const headerEntries = Object.entries(r.headers || {});
    let lang = restLangFromContentType(restHeaderValue(headerEntries.map(([key, value]) => ({ key, value })), 'content-type')) || restSniffLang(r.body);
    let pretty = r.body;
    if (lang === 'json') { try { pretty = JSON.stringify(JSON.parse(r.body), null, 2); } catch { lang = 'plaintext'; } }
    const bodyHost = el('div', { class: 'rest-resp-body-editor' });
    fill(box,
      el('div', { class: 'rest-status' },
        el('span', { class: `chip ${sevClass}`, text: `${r.status} ${r.statusText || ''}`.trim() }),
        el('span', { class: 'muted', text: `${r.timeMs} ms` }),
        el('span', { class: 'muted', text: `${new Blob([r.body || '']).size} bytes` })),
      headerEntries.length ? el('details', { class: 'rest-resp-headers' },
        el('summary', { text: `Headers (${headerEntries.length})` }),
        ...headerEntries.map(([k, v]) => el('div', { class: 'rest-resp-header-row' }, el('span', { class: 'rest-resp-header-key', text: k }), el('span', { text: v })))) : null,
      bodyHost);
    const model = monaco.editor.createModel(pretty, lang);
    const ed = monaco.editor.create(bodyHost, {
      theme: MONACO_THEMES[resolvedTheme()], fontSize: 12, fontFamily: MONO, minimap: { enabled: false },
      scrollBeyondLastLine: false, automaticLayout: true, wordWrap: 'on', readOnly: true, domReadOnly: true,
    });
    ed.setModel(model);
    restRespEditor = { editor: ed, model, tabId: tab.id };
  }
  async function sendRestRequest(tab) {
    if (!tab.url.trim()) { setStatus('Enter a URL first.'); return; }
    tab.sending = true;
    if (state.activeTab === tab.id) renderRestTab(tab);
    const headers = {};
    for (const h of tab.headers) if (h.key.trim()) headers[h.key.trim()] = h.value;
    const res = await api.rest.send({ id: tab.id, method: tab.method, url: tab.url.trim(), headers, body: tab.body, auth: tab.auth });
    tab.sending = false;
    tab.response = res;
    if (state.activeTab === tab.id) renderRestTab(tab);
  }
  async function saveRestRequest(tab) {
    const name = window.prompt('Save this request as:', tab.title && tab.title !== 'New request' ? tab.title : '');
    if (!name) return;
    const folder = window.prompt('Folder (optional - groups it in the saved-requests list; leave blank for none):', tab.folder || '');
    const list = await restSaved();
    const headers = {};
    for (const h of tab.headers) if (h.key.trim()) headers[h.key.trim()] = h.value;
    const entry = { name, method: tab.method, url: tab.url.trim(), headers, body: tab.body, auth: tab.auth, folder: (folder || '').trim() };
    // renaming a saved request (the new name differs from the entry this tab was loaded as) must drop the old
    // entry too, or it keeps living in .ide/requests.yaml as an orphaned duplicate under its old name.
    const next = list.filter((r) => r.name !== name && r.name !== tab.savedAs);
    next.push(entry);
    await api.rest.save(next);
    restCollection = next;
    tab.title = name;
    tab.savedAs = name;
    tab.folder = entry.folder;
    renderRestTab(tab); renderTabs();
    setStatus(`Saved “${name}”.`);
  }
  async function restToCurl(tab) {
    const vars = await api.env.activeVars();
    const sub = (s) => restSubstitute(s, vars);
    const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const parts = ['curl', '-X', tab.method];
    let url = sub(tab.url.trim() || tab.url);
    for (const h of tab.headers) if (h.key.trim()) parts.push('-H', shQuote(`${sub(h.key.trim())}: ${sub(h.value)}`));
    const auth = tab.auth || { type: 'none' };
    if (auth.type === 'basic') parts.push('-u', shQuote(`${sub(auth.username || '')}:${sub(auth.password || '')}`));
    else if (auth.type === 'bearer' && auth.token) parts.push('-H', shQuote(`Authorization: Bearer ${sub(auth.token)}`));
    else if (auth.type === 'apiKey' && auth.key) {
      if (auth.in === 'query') { try { const u = new URL(url); u.searchParams.set(sub(auth.key), sub(auth.value || '')); url = u.toString(); } catch { /* leave url as-is - fetch would report the same bad URL */ } }
      else parts.push('-H', shQuote(`${sub(auth.key)}: ${sub(auth.value || '')}`));
    }
    if (!/^(GET|HEAD)$/.test(tab.method) && tab.body) parts.push('-d', shQuote(sub(tab.body)));
    parts.push(shQuote(url));
    return parts.join(' ');
  }
  function renderRestTab(tab) {
    disposeRestBodyEditor();
    const host = $('#rest');
    const methodSel = el('select', { class: 'rest-method' }, ...REST_METHODS.map((m) => el('option', { value: m, text: m })));
    methodSel.value = tab.method;
    const urlIn = el('input', { type: 'text', class: 'rest', placeholder: 'https://api.example.com/...', value: tab.url, spellcheck: 'false' });
    urlIn.addEventListener('input', () => { tab.url = urlIn.value; });
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendRestRequest(tab); });
    const sendBtn = tab.sending
      ? el('button', { title: 'Cancel this request', onclick: () => api.rest.cancel(tab.id) }, ic('x'), 'Cancel')
      : el('button', { class: 'primary', title: 'Send (Enter in the URL field)', onclick: () => sendRestRequest(tab) }, ic('send'), 'Send');
    const saveBtn = el('button', { title: 'Save this request into .ide/requests.yaml', onclick: () => saveRestRequest(tab) }, ic('check'), 'Save');
    const curlBtn = el('button', { class: 'icon', title: 'Copy this request as a curl command', onclick: async () => { api.copy(await restToCurl(tab)); setStatus('Copied curl command.'); } }, ic('terminal'));
    const envSel = el('select', { class: 'rest-method rest-env', title: 'Active environment: substitutes {{name}} tokens in the URL, headers, body and auth fields' });
    envSel.replaceChildren(el('option', { value: '', text: 'No environment' }));
    envSel.addEventListener('change', async () => {
      const st = await api.env.list();
      await api.env.save({ environments: st.environments, active: envSel.value || null });
    });
    api.env.list().then((st) => {
      if (state.activeTab !== tab.id) return; // the user moved on before this resolved
      envSel.disabled = !st.environments.length;
      envSel.title = st.environments.length ? envSel.title : 'No environments yet - add .ide/environments.yaml (environments: [{name, vars}], active: name)';
      envSel.replaceChildren(el('option', { value: '', text: 'No environment' }), ...st.environments.map((e) => el('option', { value: e.name, text: e.name })));
      envSel.value = st.active || '';
    });
    const bodyHost = el('div', { class: 'rest-body-editor' });
    const bodyModel = monaco.editor.createModel(tab.body, restLangFromContentType(restHeaderValue(tab.headers, 'content-type')) || restSniffLang(tab.body));
    const bodyEd = monaco.editor.create(bodyHost, {
      theme: MONACO_THEMES[resolvedTheme()], fontSize: 13, fontFamily: MONO, minimap: { enabled: false },
      scrollBeyondLastLine: false, automaticLayout: true, wordWrap: 'on', readOnly: /^(GET|HEAD)$/.test(tab.method),
    });
    bodyEd.setModel(bodyModel);
    restBodyEditor = { editor: bodyEd, model: bodyModel, tabId: tab.id };
    // the content-type header decides the language when set explicitly; otherwise re-guess from the body
    // itself on every edit, so pasting JSON into a fresh request highlights without the user touching headers.
    const syncBodyLang = () => {
      const explicit = restLangFromContentType(restHeaderValue(tab.headers, 'content-type'));
      const lang = explicit || restSniffLang(tab.body);
      if (bodyModel.getLanguageId() !== lang) monaco.editor.setModelLanguage(bodyModel, lang);
    };
    bodyModel.onDidChangeContent(() => { tab.body = bodyModel.getValue(); syncBodyLang(); });
    methodSel.addEventListener('change', () => { tab.method = methodSel.value; bodyEd.updateOptions({ readOnly: /^(GET|HEAD)$/.test(tab.method) }); });
    const bar = el('div', { class: 'rest-bar' }, methodSel, urlIn, sendBtn, saveBtn, curlBtn, envSel);

    const authRow = el('div', { class: 'rest-auth-row' });
    const drawAuth = () => {
      const typeSel = el('select', { class: 'rest-method' }, ...REST_AUTH_TYPES.map(([v, l]) => el('option', { value: v, text: l })));
      typeSel.value = tab.auth.type;
      typeSel.addEventListener('change', () => {
        tab.auth = typeSel.value === 'apiKey' ? { type: 'apiKey', key: '', value: '', in: 'header' } : { type: typeSel.value };
        drawAuth();
      });
      const fields = [];
      if (tab.auth.type === 'basic') {
        const u = el('input', { type: 'text', class: 'rest', placeholder: 'Username', value: tab.auth.username || '', spellcheck: 'false' });
        const p = el('input', { type: 'password', class: 'rest', placeholder: 'Password', value: tab.auth.password || '' });
        u.addEventListener('input', () => { tab.auth.username = u.value; });
        p.addEventListener('input', () => { tab.auth.password = p.value; });
        fields.push(u, p);
      } else if (tab.auth.type === 'bearer') {
        const t = el('input', { type: 'text', class: 'rest', placeholder: 'Token', value: tab.auth.token || '', spellcheck: 'false' });
        t.addEventListener('input', () => { tab.auth.token = t.value; });
        fields.push(t);
      } else if (tab.auth.type === 'apiKey') {
        const k = el('input', { type: 'text', class: 'rest', placeholder: 'Header/param name', value: tab.auth.key || '', spellcheck: 'false' });
        const v = el('input', { type: 'text', class: 'rest', placeholder: 'Value', value: tab.auth.value || '', spellcheck: 'false' });
        const loc = el('select', { class: 'rest-method' }, el('option', { value: 'header', text: 'Header' }), el('option', { value: 'query', text: 'Query param' }));
        loc.value = tab.auth.in || 'header';
        k.addEventListener('input', () => { tab.auth.key = k.value; });
        v.addEventListener('input', () => { tab.auth.value = v.value; });
        loc.addEventListener('change', () => { tab.auth.in = loc.value; });
        fields.push(k, v, loc);
      }
      authRow.replaceChildren(el('span', { class: 'muted', text: 'Auth' }), typeSel, ...fields);
    };
    drawAuth();

    const headerRows = el('div', { class: 'rest-headers' });
    const drawHeaders = () => {
      headerRows.replaceChildren(...tab.headers.map((h, i) => {
        const k = el('input', { type: 'text', class: 'rest', placeholder: 'Header', value: h.key, spellcheck: 'false', list: 'rest-header-names' });
        const v = el('input', { type: 'text', class: 'rest', placeholder: 'Value', value: h.value, spellcheck: 'false' });
        k.addEventListener('input', () => { h.key = k.value; syncBodyLang(); });
        v.addEventListener('input', () => { h.value = v.value; syncBodyLang(); });
        return el('div', { class: 'rest-header-row' }, k, v, el('button', { class: 'icon', title: 'Remove this header', onclick: () => { tab.headers.splice(i, 1); drawHeaders(); syncBodyLang(); } }, ic('x')));
      }), el('button', { class: 'icon', title: 'Add a header', onclick: () => { tab.headers.push({ key: '', value: '' }); drawHeaders(); } }, ic('plus'), 'Header'));
    };
    drawHeaders();

    const respBox = el('div', { class: 'rest-response' });
    renderRestResponse(respBox, tab);

    const sideList = el('div', { class: 'rest-list' });
    restSaved().then((list) => {
      if (state.activeTab !== tab.id) return; // the user moved on before this resolved
      const row = (r) => {
        const loadSaved = () => {
          tab.title = r.name; tab.method = r.method; tab.url = r.url; tab.savedAs = r.name; tab.folder = r.folder || '';
          tab.headers = Object.entries(r.headers || {}).map(([key, value]) => ({ key, value }));
          tab.body = r.body || ''; tab.auth = r.auth || { type: 'none' }; tab.response = null;
          renderRestTab(tab); renderTabs();
        };
        const removeSaved = async (e) => {
          e.stopPropagation();
          if (!window.confirm(`Delete the saved request “${r.name}”?`)) return;
          const next = list.filter((x) => x.name !== r.name);
          await api.rest.save(next);
          restCollection = next;
          if (tab.savedAs === r.name) tab.savedAs = null;
          renderRestTab(tab);
        };
        return el('div', { class: 'rest-saved-item', title: `${r.method} ${r.url}`, onclick: loadSaved },
          el('span', { class: 'rest-saved-method', text: r.method }), el('span', { text: r.name }),
          el('span', { class: 'spacer' }),
          el('button', { class: 'icon', title: 'Delete this saved request', onclick: removeSaved }, ic('x')));
      };
      // folder is just a string tag on each entry (no folder CRUD) - group by it for display, ungrouped first
      const groups = new Map();
      for (const r of list) { const key = r.folder || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
      const order = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
      const rows = [];
      for (const key of order) {
        if (key) rows.push(el('div', { class: 'rest-folder-head', text: key }));
        rows.push(...groups.get(key).map(row));
      }
      sideList.replaceChildren(...rows);
      if (!list.length) sideList.append(el('div', { class: 'empty', text: 'No saved requests yet.' }));
    });

    host.replaceChildren(el('div', { class: 'rest-pane' },
      el('div', { class: 'rest-side' }, el('div', { class: 'rest-side-head', text: 'Saved requests' }), sideList),
      el('div', { class: 'rest-main' }, bar, authRow, headerRows, bodyHost, respBox)),
      el('datalist', { id: 'rest-header-names' }, ...REST_HEADER_NAMES.map((name) => el('option', { value: name }))));
  }

  async function runChecks(tier) {
    if (state.checksRunning || !state.project || !state.project.root) return null;
    state.checksRunning = true;
    state.runProgress = { done: [], running: null };
    setButtons();
    showBottom('problems');
    renderProblems();
    const res = await api.checks.run({ tier, files: 'changed' });
    state.checksRunning = false;
    state.lastResult = res;
    setButtons();
    renderProblems();
    applyAllMarkers();
    updateStatus();
    return res;
  }

  api.checks.onProgress((evt) => {
    if (evt.type === 'start') state.runProgress.running = evt.name;
    else { state.runProgress.running = null; state.runProgress.done.push(evt.run); }
    if (state.checksRunning) renderProblems();
  });

  // ---------------------------------------------------------------- AI review
  function renderReview() {
    const host = $('#review');
    const rv = state.review;
    const head = el('div', { class: 'p-head' });
    if (rv.running) head.append(el('b', { text: 'Reviewing… (sending the diff to your review command)' }), el('button', { onclick: () => api.review.cancel() }, ic('x'), 'Cancel'));
    else {
      head.append(el('b', { text: rv.error ? 'Review failed' : 'AI review' }));
      if (rv.output) head.append(el('span', { class: 'spacer' }),
        el('button', { onclick: () => api.copy(rv.output) }, ic('clipboard-copy'), 'Copy'),
        el('button', { title: 'Paste the review into the focused terminal so the agent can act on it', onclick: () => pasteIntoTerminal(`Please address this code review:\n${rv.output}\n`) }, ic('send'), 'Send to terminal'),
        el('button', { onclick: runReview }, ic('refresh-cw'), 'Run again'));
      else head.append(el('span', { class: 'spacer' }), el('button', { onclick: runReview }, ic('refresh-cw'), 'Run again'));
    }
    const pre = el('pre', { class: 'review-out' });
    if (rv.error) pre.append(rv.error);
    else if (rv.running) pre.append('Waiting for the review command…');
    else {
      for (const line of rv.output.split('\n')) {
        const m = /^(\s*(?:[-*•]|\d+[.)])?\s*)([\w@./\\-]+\.[A-Za-z0-9]{1,6}):(\d+)(.*)$/.exec(line);
        if (m) pre.append(m[1], el('span', { class: 'link', text: `${m[2]}:${m[3]}`, onclick: () => openFile(m[2].replace(/\\/g, '/'), Number(m[3])) }), `${m[4]}\n`);
        else pre.append(`${line}\n`);
      }
    }
    host.replaceChildren(head, pre);
  }

  async function runReview() {
    if (state.review.running) { api.review.cancel(); return null; }
    if (!state.project || !state.project.root) return null;
    state.review = { used: true, running: true, output: '', error: '' };
    setButtons();
    showBottom('review');
    renderReview();
    const res = await api.review.run(visibleFindings());
    state.review.running = false;
    if (res.cancelled) state.review.output = '(cancelled)';
    else if (res.error) state.review.error = res.error;
    else state.review.output = res.output;
    setButtons();
    renderReview();
    renderBottomTabs();
    return res;
  }

  // ---------------------------------------------------------------- settings dialog
  async function openSettings() {
    const { settings, defaults, templatesMd } = await api.settings.get();
    const agents = (settings.agents && settings.agents.length ? settings.agents : defaults.agents).map((a) => ({ ...a }));
    const shell = el('input', { type: 'text', placeholder: api.platform === 'win32' ? 'default: powershell.exe  (or cmd.exe, a Git Bash path...)' : 'default: $SHELL', value: settings.shell || '' });
    const shellArgs = el('input', { type: 'text', placeholder: 'optional arguments, space separated', value: (settings.shellArgs || []).join(' ') });
    const review = el('input', { type: 'text', value: settings.reviewCommand || '', placeholder: defaults.reviewCommand });
    const customThemes = (settings.customThemes || []).map((c) => ({ ...c }));
    const themeSel = el('select', null,
      ...Object.entries(THEME_META).map(([value, m]) => el('option', { value, text: value === 'system' ? 'Follow the system' : m.label })),
      ...customThemes.map((c) => el('option', { value: c.id, text: c.label })));
    themeSel.value = settings.theme || defaults.theme || 'system';
    const customThemeBox = el('div');
    const drawCustomThemes = () => customThemeBox.replaceChildren(...customThemes.map((c) => el('div', { class: 'agent-row' },
      el('span', { style: 'flex:1' }, c.label),
      el('button', { class: 'icon', title: 'Edit this theme', onclick: () => openThemeEditor(c) }, ic('palette')),
      el('button', { class: 'icon danger', title: 'Delete this theme', 'aria-label': `Delete ${c.label}`, onclick: async () => {
        if (!window.confirm(`Delete the theme “${c.label}”?`)) return;
        const cur = await api.settings.get();
        const list = (cur.settings.customThemes || []).filter((x) => x.id !== c.id);
        const nextSettings = { ...cur.settings, customThemes: list };
        if (cur.settings.theme === c.id) nextSettings.theme = 'system';
        await api.settings.save(nextSettings);
        await loadProject();
        await openSettings();
      } }, ic('trash-2')))));
    drawCustomThemes();
    const auto = el('input', { type: 'checkbox' }); auto.checked = settings.autoCheck !== undefined ? !!settings.autoCheck : !!defaults.autoCheck;
    const cp = el('input', { type: 'checkbox' }); cp.checked = settings.autoCheckpoint !== undefined ? !!settings.autoCheckpoint : !!defaults.autoCheckpoint;
    const num = (v, d, min, max) => el('input', { type: 'number', value: String(v ?? d), min: String(min), max: String(max), style: 'width:80px' });
    const fl = { ...defaults.fixLoop, ...(settings.fixLoop || {}) };
    const flOn = el('input', { type: 'checkbox' }); flOn.checked = !!fl.enabled;
    const flRounds = num(fl.maxRounds, 3, 1, 10);
    const flTests = el('input', { type: 'checkbox' }); flTests.checked = !!fl.relatedTests;
    const flTestSec = num(fl.testTimeoutSec, 120, 10, 1800);
    const flIdle = num(fl.idleSeconds, 8, 2, 120);
    const flInclude = el('select', null, el('option', { value: 'error', text: 'errors only' }), el('option', { value: 'warning', text: 'errors and warnings' }));
    flInclude.value = fl.include || 'error';
    const flEsc = el('select', { title: 'A stronger agent that takes over the same working copy when this one cannot get the gates clean' }, el('option', { value: '', text: 'nobody (keep trying, then stop)' }), ...agents.map((a) => el('option', { value: a.name, text: a.name })));
    flEsc.value = (fl.escalate && fl.escalate.agent) || '';
    const flEscAfter = num(fl.escalate && fl.escalate.after, 2, 1, 10);
    const amCur = { ...defaults.autoMerge, ...(settings.autoMerge || {}) };
    const amOn = el('input', { type: 'checkbox' }); amOn.checked = !!amCur.enabled;
    const amRate = num(Math.round((amCur.minWinRate ?? 0.8) * 100), 80, 50, 100);
    const amDry = el('input', { type: 'checkbox' }); amDry.checked = !!amCur.dryRun;
    const amKindSel = {}; // null/absent amCur.kinds = every kind allowed (today's behaviour) = every box checked
    for (const k of Object.keys(KIND_LABELS)) {
      amKindSel[k] = el('input', { type: 'checkbox' });
      amKindSel[k].checked = !Array.isArray(amCur.kinds) || amCur.kinds.includes(k);
    }
    const notif = el('input', { type: 'checkbox' }); notif.checked = settings.notifications !== undefined ? !!settings.notifications : defaults.notifications !== false;
    const edFont = num(settings.editorFontSize, 13, 8, 32);
    const termFont = num(settings.terminalFontSize, 13, 8, 32);
    const fontFam = el('select', { id: 'set-font-family', title: 'Used for the editor, terminals, and every monospace spot in the UI (review output, journal, code in markdown...)' }, ...Object.entries(MONO_FONTS).map(([id, v]) => el('option', { value: id, text: v.label })));
    fontFam.value = MONO_FONTS[settings.monoFont] ? settings.monoFont : (defaults.monoFont || 'roboto-mono');
    const scrollback = num(settings.terminalScrollback || defaults.terminalScrollback, 2000, 200, 50000);
    const guardCur = { ...defaults.mergeGuardDefaults, ...(settings.mergeGuard || {}) };
    const guardSel = {};
    for (const k of Object.keys(GUARD_LABELS)) {
      guardSel[k] = el('select', null, el('option', { value: 'block', text: 'block' }), el('option', { value: 'warn', text: 'warn' }), el('option', { value: 'off', text: 'ignore' }));
      guardSel[k].value = guardCur[k] || 'warn';
    }
    // adaptive guard rules: the same "you've overridden this N times, relax it?" suggestions the merge dialog
    // offers, visible here too (not only at the moment of an override), plus a table of every count so far.
    const guardOv = await api.guardoverrides.get().catch(() => ({ suggestions: [], counts: {} }));
    const guardSuggestBox = el('div');
    const guardCountsBox = el('div');
    const renderGuardSuggestions = () => {
      const relevant = (guardOv.suggestions || []).filter((s) => guardSel[s.id]);
      if (!relevant.length) { fill(guardSuggestBox); return; }
      fill(guardSuggestBox, el('div', { class: 'guard-suggestion' }, ...relevant.map((s) => guardSuggestionRow(s, GUARD_LABELS[s.id] || s.id, {
        onRelaxed: (sg) => { guardSel[sg.id].value = sg.next; guardOv.suggestions = guardOv.suggestions.filter((x) => x.id !== sg.id); renderGuardSuggestions(); renderGuardCounts(); },
        onDismissed: (row) => row.remove(),
      }))));
    };
    const renderGuardCounts = () => {
      const entries = Object.entries(guardOv.counts || {}).filter(([, n]) => n > 0);
      if (!entries.length) { fill(guardCountsBox); return; }
      fill(guardCountsBox, el('div', { class: 'hint', text: 'How many times you have ticked “merge anyway” past each blocker, across every project:' }),
        el('table', { class: 'sc-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Rule' }), el('th', { text: 'Times overridden' }), el('th'))),
          el('tbody', null, ...entries.sort((a, b) => b[1] - a[1]).map(([id, count]) => {
            const resetBtn = el('button', { class: 'icon', title: 'Reset this count', 'aria-label': `Reset ${GUARD_LABELS[id] || id}` }, ic('undo-2'));
            resetBtn.addEventListener('click', async () => { await api.guardoverrides.reset(id); delete guardOv.counts[id]; renderGuardCounts(); });
            return el('tr', null, el('td', { text: GUARD_LABELS[id] || id }), el('td', { text: String(count) }), el('td', null, resetBtn));
          }))));
    };
    renderGuardSuggestions();
    renderGuardCounts();
    const rulesIn = el('textarea', { rows: '4', placeholder: 'Rules the AI review should check in every project, e.g. “No field injection. Every endpoint needs an authorization check.”', spellcheck: 'false' });
    rulesIn.value = settings.reviewRules || '';
    const tplIn = el('textarea', { rows: '5', placeholder: '## Name of a template\nallow: src/**   (optional first line)\nThe task text, e.g. Fix this bug: <describe it>', spellcheck: 'false' });
    tplIn.value = templatesMd || '';
    const budgetIn = num(settings.runBudgetMinutes, 0, 0, 1440);
    const aeCur = { ...defaults.agentEnv, ...(settings.agentEnv || {}) };
    const scrubOn = el('input', { type: 'checkbox' }); scrubOn.checked = aeCur.scrub !== false;
    const scrubAllow = el('input', { type: 'text', value: (aeCur.allow || []).join(' '), placeholder: 'variable names to keep, space separated (e.g. GITHUB_TOKEN)', spellcheck: 'false' });
    const ccCur = { enabled: false, image: 'bazinga-agent:latest', network: 'bridge', memory: '4g', cpus: '2', passEnv: ['ANTHROPIC_API_KEY'], ...(settings.agentContainer || {}) };
    const ccOn = el('input', { type: 'checkbox' }); ccOn.checked = !!ccCur.enabled;
    const ccImage = el('input', { type: 'text', value: ccCur.image, spellcheck: 'false', style: 'max-width:220px' });
    const ccNet = el('select', null, el('option', { value: 'bridge', text: 'network on' }), el('option', { value: 'none', text: 'no network' })); ccNet.value = ccCur.network;
    const ccMem = el('input', { type: 'text', value: ccCur.memory, style: 'width:60px' });
    const ccCpu = el('input', { type: 'text', value: ccCur.cpus, style: 'width:50px' });
    const ccEnv = el('input', { type: 'text', value: (ccCur.passEnv || []).join(' '), placeholder: 'e.g. ANTHROPIC_API_KEY', spellcheck: 'false' });
    const levels = defaults.oversightLevels || {};
    const lvlSel = el('select', null, el('option', { value: '', text: 'Custom (use the individual settings below)' }), ...Object.entries(levels).map(([id, l]) => el('option', { value: id, text: l.label })));
    lvlSel.value = settings.oversight || '';
    const lvlHint = el('div', { class: 'hint' });
    const levelDependent = [flOn, flRounds, flTests, flTestSec, flIdle, flInclude, flEsc, flEscAfter, ...Object.values(guardSel), amOn, amRate, amDry, ...Object.values(amKindSel)];
    const amHint = el('div', { class: 'hint' });
    const applyLevel = () => {
      const lv = lvlSel.value;
      for (const c of levelDependent) c.disabled = !!lv;
      const proj = state.project && state.project.oversight;
      lvlHint.textContent = (lv ? levels[lv].summary + ' The fix loop and merge guard settings below are set by the level.' : 'No level: the individual settings below apply.')
        + (proj && proj.source === 'project' ? ` This project sets “${proj.label}” in .ide/config.json, which takes precedence here.` : '');
      amHint.textContent = lv === 'autonomous' ? 'This level turns auto-merge on by default (still only once the guard is clean and the scorecard backs it).'
        : lv ? 'This level does not touch auto-merge; pick “Custom” to control it yourself.' : '';
    };
    lvlSel.addEventListener('change', applyLevel); applyLevel();
    const lensCur = { usages: true, blame: true, spring: true, ...(settings.symbolLenses || {}) };
    const lensUsages = el('input', { type: 'checkbox' }); lensUsages.checked = lensCur.usages !== false;
    const lensBlame = el('input', { type: 'checkbox' }); lensBlame.checked = lensCur.blame !== false;
    const lensSpring = el('input', { type: 'checkbox' }); lensSpring.checked = lensCur.spring !== false;
    const elOn = el('input', { type: 'checkbox' }); elOn.checked = (settings.errorLens || {}).enabled !== false;
    const minimapOnInput = el('input', { type: 'checkbox' }); minimapOnInput.checked = !!(settings.minimap || {}).enabled;
    // Keyboard tab: working copy of the overrides, mutated as the user rebinds/resets, applied to next.keybindings
    // on Save. Only entries that differ from the default are ever kept (null = explicitly unbound), same delta
    // storage every other setting here uses.
    const kbOverrides = { ...(settings.keybindings || {}) };
    const kbDefault = (id) => (DEFAULT_KEYBINDINGS.find((k) => k.id === id) || {}).chord || null;
    const kbRows = el('div', { class: 'kb-rows' });
    const drawKeyboardRows = () => {
      const resolved = resolveKeybindings(kbOverrides);
      const conflicts = new Map(findKeybindingConflicts(resolved).flatMap((c) => c.ids.map((id) => [id, c.chord])));
      kbRows.replaceChildren(...DEFAULT_KEYBINDINGS.map(({ id, title }) => {
        const chord = resolved[id];
        const isCustom = Object.prototype.hasOwnProperty.call(kbOverrides, id);
        const btn = el('button', { class: 'kb-chord', title: 'Click, then press the new key combination' }, chord ? chordLabel(chord) : 'Not set');
        btn.addEventListener('click', () => {
          btn.textContent = 'Press a key…'; btn.classList.add('kb-listening');
          const capture = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape') { drawKeyboardRows(); cleanup(); return; }
            const next = chordFromEvent(e);
            if (!next) return; // a bare modifier keydown - keep listening
            if (next === kbDefault(id)) delete kbOverrides[id]; else kbOverrides[id] = next;
            drawKeyboardRows();
            cleanup();
          };
          const cleanup = () => document.removeEventListener('keydown', capture, true);
          document.addEventListener('keydown', capture, true);
        });
        const resetBtn = isCustom ? el('button', { class: 'icon', title: 'Reset to default' }, ic('refresh-cw')) : null;
        if (resetBtn) resetBtn.addEventListener('click', () => { delete kbOverrides[id]; drawKeyboardRows(); });
        const conflictNote = conflicts.has(id) ? el('span', { class: 'kb-conflict', title: 'Another command uses the same keys' }, ic('triangle-alert'), ' Also used elsewhere') : null;
        return el('div', { class: 'kb-row' }, el('span', { class: 'kb-title', text: title }), btn, resetBtn, conflictNote);
      }));
    };
    drawKeyboardRows();
    const lspCur = settings.lsp || {};
    const lspOn = el('input', { type: 'checkbox' }); lspOn.checked = !!lspCur.enabled;
    const LSP_DEFAULTS = { java: 'jdtls', python: 'pyright-langserver', typescript: 'typescript-language-server', go: 'gopls', rust: 'rust-analyzer', csharp: 'csharp-ls' };
    const lspCmd = {};
    for (const [name, dflt] of Object.entries(LSP_DEFAULTS)) {
      lspCmd[name] = el('input', { type: 'text', placeholder: `default: ${dflt}`, value: (lspCur.servers && lspCur.servers[name] && lspCur.servers[name].command) || '', spellcheck: 'false' });
    }
    const icCur = { ...defaults.inlineCompletion, ...(settings.inlineCompletion || {}) };
    const icOn = el('input', { type: 'checkbox' }); icOn.checked = !!icCur.enabled;
    const icBaseUrl = el('input', { type: 'text', placeholder: 'default: the first agent pointed at an Ollama server', value: icCur.baseUrl || '', spellcheck: 'false' });
    const icModel = el('input', { type: 'text', placeholder: 'default: that agent’s model', value: icCur.model || '', spellcheck: 'false' });
    const icDebounce = num(icCur.debounceMs, 400, 100, 3000);
    const agentBox = el('div');
    const drawAgents = () => agentBox.replaceChildren(...agents.map((a, i) => {
      const n = el('input', { type: 'text', value: a.name, placeholder: 'Name' }); n.style.maxWidth = '140px';
      const c = el('input', { type: 'text', value: a.command, placeholder: 'Command to run in the terminal' });
      const e = el('input', { type: 'text', value: Object.entries(a.env || {}).map(([k, v]) => `${k}=${v}`).join(' '), placeholder: 'env: KEY=value KEY2=value', title: 'Environment variables for this agent, separated by spaces (no spaces inside values)' });
      e.style.maxWidth = '200px';
      n.addEventListener('input', () => { a.name = n.value; });
      c.addEventListener('input', () => {
        // keep an auto-named button in step with the model in its command
        const before = modelOf(a.command);
        a.command = c.value;
        const after = modelOf(a.command);
        if (after && (!a.name || a.name === before)) { a.name = after; n.value = after; }
      });
      e.addEventListener('input', () => {
        const env = {};
        for (const part of e.value.split(/\s+/)) { const i = part.indexOf('='); if (i > 0) env[part.slice(0, i)] = part.slice(i + 1); }
        if (Object.keys(env).length) a.env = env; else delete a.env;
      });
      const h = el('textarea', { rows: '2', class: 'agent-hint', placeholder: 'Standing instructions for this agent (optional, Claude Code only). Given with every session; add project rules in .ide/agent-hint.md', spellcheck: 'false' });
      h.value = a.hint || '';
      h.addEventListener('input', () => { if (h.value.trim()) a.hint = h.value; else delete a.hint; });
      return el('div', { class: 'agent-block' }, el('div', { class: 'agent-row' }, n, c, e, isLocalAgent(a) && /^\s*(?:[^\s]*[\\/])?claude/i.test(a.command || '') ? el('button', { title: 'Check that this model can be sent a file, read one and write one to disk', onclick: () => testAgentModel(a) }, ic('flask-conical'), 'Test') : '', el('button', { class: 'icon danger', title: 'Remove', 'aria-label': 'Remove agent', onclick: () => { agents.splice(i, 1); drawAgents(); } }, ic('trash-2'))), h);
    }));
    drawAgents();
    const close = () => $('#modal').classList.add('hidden');
    const save = async () => {
      const next = { ...settings };
      const setOrDrop = (k, v) => { if (v === '' || v === undefined) delete next[k]; else next[k] = v; };
      setOrDrop('shell', shell.value.trim());
      setOrDrop('shellArgs', shellArgs.value.trim() ? shellArgs.value.trim().split(/\s+/) : undefined);
      setOrDrop('reviewCommand', review.value.trim());
      next.theme = themeSel.value;
      next.autoCheck = auto.checked;
      next.autoCheckpoint = cp.checked;
      next.agents = agents.filter((a) => a.name.trim() && a.command.trim());
      next.fixLoop = { ...fl, enabled: flOn.checked, maxRounds: Math.min(10, Math.max(1, Number(flRounds.value) || 3)), idleSeconds: Math.min(120, Math.max(2, Number(flIdle.value) || 8)), include: flInclude.value, escalate: { agent: flEsc.value, after: Math.min(10, Math.max(1, Number(flEscAfter.value) || 2)) }, relatedTests: flTests.checked, testTimeoutSec: Math.min(1800, Math.max(10, Number(flTestSec.value) || 120)) };
      next.taskTemplatesMd = tplIn.value;
      setOrDrop('reviewRules', rulesIn.value.trim());
      next.agentContainer = { enabled: ccOn.checked, image: ccImage.value.trim() || 'bazinga-agent:latest', network: ccNet.value, memory: ccMem.value.trim() || '4g', cpus: ccCpu.value.trim() || '2', passEnv: ccEnv.value.split(/[\s,]+/).filter(Boolean) };
      next.runBudgetMinutes = Math.min(1440, Math.max(0, Math.round(Number(budgetIn.value)) || 0));
      next.agentHooks = hooksOn.checked;
      next.ollama = { baseUrl: serverUrl(), keepWarm: warmOn.checked, unloadOthers: unloadOn.checked, noThink: noThinkOn.checked, repair: repairOn.checked, lean: leanOn.checked, restrictTools: restrictOn.checked, testMinutes: Math.min(120, Math.max(2, parseInt(testMin.value, 10) || 15)), maxOutputTokens: Math.min(32000, Math.max(1024, parseInt(maxOut.value, 10) || 8192)), keepAlive: /^\d+[smh]$/.test(warmFor.value.trim()) ? warmFor.value.trim() : '15m' };
      next.agentEnv = { scrub: scrubOn.checked, allow: scrubAllow.value.split(/[\s,]+/).filter(Boolean) };
      next.notifications = notif.checked;
      next.symbolLenses = { usages: lensUsages.checked, blame: lensBlame.checked, spring: lensSpring.checked };
      const servers = {};
      for (const [name, input] of Object.entries(lspCmd)) if (input.value.trim()) servers[name] = { ...((lspCur.servers || {})[name] || {}), command: input.value.trim() };
      next.lsp = { ...lspCur, enabled: lspOn.checked, servers };
      next.inlineCompletion = { enabled: icOn.checked, baseUrl: icBaseUrl.value.trim(), model: icModel.value.trim(), debounceMs: Math.min(3000, Math.max(100, Number(icDebounce.value) || 400)) };
      next.editorFontSize = Math.min(32, Math.max(8, Number(edFont.value) || 13));
      next.terminalFontSize = Math.min(32, Math.max(8, Number(termFont.value) || 13));
      next.monoFont = fontFam.value;
      next.terminalScrollback = Math.min(50000, Math.max(200, Math.round(Number(scrollback.value)) || 2000));
      next.mergeGuard = Object.fromEntries(Object.entries(guardSel).map(([k, sel]) => [k, sel.value]));
      const amKindsChecked = Object.keys(KIND_LABELS).filter((k) => amKindSel[k].checked);
      next.autoMerge = { enabled: amOn.checked, minWinRate: Math.min(1, Math.max(0.5, (Number(amRate.value) || 80) / 100)), dryRun: amDry.checked, kinds: amKindsChecked.length === Object.keys(KIND_LABELS).length ? null : amKindsChecked };
      if (lvlSel.value) {
        // a level owns the fix loop, merge guard and auto-merge: keep only what the level does not decide
        next.oversight = lvlSel.value;
        delete next.fixLoop; delete next.mergeGuard; delete next.autoMerge;
      } else delete next.oversight;
      next.errorLens = { enabled: elOn.checked };
      next.minimap = { enabled: minimapOnInput.checked };
      next.keybindings = { ...kbOverrides };
      await api.settings.save(next);
      close();
      const keepAuto = state.autoCheck;
      await loadProject();
      state.autoCheck = auto.checked !== !!defaults.autoCheck ? auto.checked : keepAuto;
      $('#auto').checked = state.autoCheck;
      refreshErrorLens();
      refreshMinimap();
      setStatus('Settings saved.');
    };
    const AGENT_PRESETS = [
      ['Claude Code', { name: 'Claude', command: 'claude', taskCommand: 'claude {task}' }],
      ['GitHub Copilot CLI', { name: 'Copilot', command: 'copilot', taskCommand: 'copilot -i {task}' }],
      ['Claude Code on a local model (Ollama)', { name: 'qwen3:8b', command: localClaudeCmd('qwen3:8b'), hint: LOCAL_HINT, env: localEnv() }],
      ['Aider on a local model (Ollama)', { name: 'qwen3:8b', command: 'aider --model ollama_chat/qwen3:8b', env: { OLLAMA_API_BASE: 'http://127.0.0.1:11434' } }],
      ['Claude Code on an OpenAI-style server (LM Studio, llama.cpp, vLLM, gateways)', { name: 'LM Studio', command: localClaudeCmd('your-model-name'), api: 'openai', context: 32768, hint: LOCAL_HINT, env: { ANTHROPIC_BASE_URL: 'http://localhost:1234/v1', ANTHROPIC_AUTH_TOKEN: 'lm-studio', ANTHROPIC_API_KEY: '' } }],
      ['ACP agent (Agent Client Protocol; type the command your agent documents)', { name: 'ACP agent', command: 'your-agent --acp', protocol: 'acp', policy: 'ask' }],
      ['OpenAI Codex CLI', { name: 'Codex', command: 'codex', taskCommand: 'codex {task}', resumeCommand: 'codex resume --last' }],
      ['Google Gemini CLI', { name: 'Gemini', command: 'gemini', taskCommand: 'gemini -i {task}', resumeCommand: 'gemini --resume latest' }],
      // aider -m/--message is one-shot (it exits after that message), not "start interactive with this opening message"
      // like the other presets' taskCommand - so, like the local-model Aider preset above, the task is pasted in instead.
      ['Aider (cloud API)', { name: 'Aider', command: 'aider' }],
    ];
    const presetSel = el('select', { id: 'set-preset', title: 'Add a ready-made agent button; edit the model name afterwards' }, el('option', { value: '', text: 'Add from a preset…' }), ...AGENT_PRESETS.map(([label], i) => el('option', { value: String(i), text: label })));
    presetSel.addEventListener('change', () => {
      const v = presetSel.value;
      presetSel.value = '';
      if (v.startsWith('m:')) { const m = v.slice(2); agents.push({ name: m, command: localClaudeCmd(m), hint: LOCAL_HINT, env: localEnv(serverUrl()) }); drawAgents(); return; }
      const p = AGENT_PRESETS[Number(v)];
      if (p) {
        const a = JSON.parse(JSON.stringify(p[1]));
        const url = serverUrl();
        if (a.env && a.env.ANTHROPIC_BASE_URL && a.api !== 'openai') a.env.ANTHROPIC_BASE_URL = url; // the server chosen above, not always this machine
        if (a.env && a.env.OLLAMA_API_BASE) a.env.OLLAMA_API_BASE = url;
        agents.push(a); drawAgents();
      }
    });
    // the Ollama server the presets point at: this machine, or another one on the network
    const ol = { ...(defaults.ollama || {}), ...(settings.ollama || {}) };
    const urlIn = el('input', { type: 'text', value: ol.baseUrl || DEFAULT_OLLAMA_URL, placeholder: DEFAULT_OLLAMA_URL, spellcheck: 'false', title: 'Where Ollama runs, e.g. http://localhost:11434 or http://gpu-box:11434. For another machine, start Ollama there with OLLAMA_HOST=0.0.0.0' });
    urlIn.style.minWidth = '260px';
    const urlNote = el('div', { class: 'hint' });
    const serverUrl = () => normalizeServerUrl(urlIn.value);
    // the models that server has installed, as ready-made Claude Code buttons
    const loadModels = () => {
      const url = serverUrl();
      for (const o of [...presetSel.querySelectorAll('[data-dyn]')]) o.remove();
      const remote = isRemoteUrl(url);
      urlNote.textContent = remote ? 'A model on another machine: prompts and your code travel over the network unencrypted (plain http). Use it on a network you trust, or put it behind a VPN or an https proxy.' : '';
      api.ollama.list(url).then((st) => {
        if (!presetSel.isConnected || serverUrl() !== url) return;
        for (const o of [...presetSel.querySelectorAll('[data-dyn]')]) o.remove();
        if (!st.running) { presetSel.append(el('option', { value: '', text: `(no Ollama answers at ${url})`, disabled: 'true', 'data-dyn': '1' })); return; }
        const g = el('optgroup', { label: `Installed at ${url}`, 'data-dyn': '1' });
        for (const m of st.installed) g.append(el('option', { value: `m:${m.name}`, text: `Claude Code on ${m.name} (${(m.size / 1e9).toFixed(1)} GB)` }));
        if (st.installed.length) presetSel.append(g);
      }).catch(() => {});
    };
    urlIn.addEventListener('change', loadModels);
    loadModels();
    // ---- llama.cpp: Bazinga runs llama-server itself (Ollama is a daemon it only talks to; llama.cpp has none,
    // so Bazinga owns the process and a model-download manager on top of it - see core/llamacpp.js/llamamodels.js).
    let llamaInstalled = [];
    let llamaRunningStatus = null;
    const llamaModelSel = el('select', { id: 'llama-model' });
    const llamaStatusLine = el('div', { class: 'hint' }, 'Checking llama.cpp…');
    const llamaStartBtn = el('button', { onclick: () => llamaToggle() }, ic('play'), ' Start');
    const llamaDownloadBtn = el('button', { onclick: () => openLlamaDownloadPanel() }, ic('download'), ' Download model…');
    async function refreshLlamaModels() {
      const cur = llamaModelSel.value;
      llamaInstalled = await api.llamamodels.list();
      if (llamaInstalled.error) llamaInstalled = [];
      llamaModelSel.replaceChildren(
        el('option', { value: '', text: llamaInstalled.length ? 'Pick a downloaded model…' : 'No models downloaded yet' }),
        ...llamaInstalled.map((m) => el('option', { value: m.id, text: `${m.file} (${(m.size / 1e9).toFixed(1)} GB)` })),
      );
      if (llamaInstalled.some((m) => m.id === cur)) llamaModelSel.value = cur;
    }
    async function refreshLlamaStatus() {
      const st = await api.llamacpp.status();
      llamaRunningStatus = st && st.running ? st : null;
      llamaStartBtn.replaceChildren(ic(llamaRunningStatus ? 'square' : 'play'), llamaRunningStatus ? ' Stop' : ' Start');
      llamaModelSel.disabled = !!llamaRunningStatus; // switching models is stop, then start again - never a live swap
      llamaStatusLine.textContent = llamaRunningStatus
        ? `Running: ${llamaRunningStatus.alias || llamaRunningStatus.model} on port ${llamaRunningStatus.port} (${llamaRunningStatus.ctxSize} context).`
        : st && st.hasBinary === false ? 'llama-server was not found on PATH and no downloaded copy exists yet.' : 'Not running.';
    }
    async function llamaToggle() {
      llamaStartBtn.disabled = true;
      try {
        if (llamaRunningStatus) { await api.llamacpp.stop(); await refreshLlamaStatus(); return; }
        const modelId = llamaModelSel.value;
        if (!modelId) { setStatus('Pick a downloaded model first.'); return; }
        const st = await api.llamacpp.status();
        if (!st.hasBinary) {
          if (!window.confirm('llama-server is not installed. Download the plain CPU build now from the project’s GitHub releases?')) return;
          llamaStatusLine.textContent = 'Downloading llama-server…';
          const off = api.llamacpp.onBinaryDownloadProgress((p) => { llamaStatusLine.textContent = `Downloading llama-server… ${(p.bytesDownloaded / 1e6).toFixed(0)}/${(p.totalBytes / 1e6).toFixed(0)} MB`; });
          try { const r = await api.llamacpp.downloadBinary(); if (r && r.error) { setStatus(r.error); return; } } finally { off(); }
        }
        const r = await api.llamacpp.start({ modelId });
        if (r && r.error) { setStatus(r.error); return; }
        await refreshLlamaStatus();
        const picked = llamaInstalled.find((m) => m.id === modelId);
        agents.push({ name: (picked && picked.file.replace(/\.gguf$/i, '')) || 'llama.cpp', command: localClaudeCmd(r.alias), api: 'openai', hint: LOCAL_HINT, env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${r.port}/v1`, ANTHROPIC_AUTH_TOKEN: 'llama-cpp', ANTHROPIC_API_KEY: '' } });
        drawAgents();
        setStatus(`llama.cpp is running ${r.alias}.`);
      } finally { llamaStartBtn.disabled = false; }
    }
    function openLlamaDownloadPanel() {
      let seq = 0;
      const q = el('input', { type: 'text', placeholder: 'Search Hugging Face, e.g. "qwen2.5 coder gguf"' });
      const results = el('div', { class: 'llama-search-results' });
      const urlField = el('input', { type: 'text', placeholder: 'or paste a Hugging Face .gguf file URL' });
      const urlBtn = el('button', { onclick: () => downloadFromUrl(urlField.value) }, ic('download'), ' Download');
      const fileRow = (repo, f) => {
        const bar = el('div', { class: 'hint llama-progress' });
        const btn = el('button', {}, ic('download'), ` ${f.file}${f.sizeBytes ? ` (${(f.sizeBytes / 1e9).toFixed(1)} GB)` : ''}`);
        btn.onclick = async () => {
          btn.disabled = true; bar.textContent = 'Starting…';
          const off = api.llamamodels.onDownloadProgress((p) => { if (p.repo === repo && p.file === f.file) bar.textContent = `${(p.bytesDownloaded / 1e6).toFixed(0)} / ${(p.totalBytes / 1e6).toFixed(0)} MB`; });
          try {
            const r = await api.llamamodels.download({ repo, file: f.file, sizeBytes: f.sizeBytes, sha256: f.sha256 });
            if (r && r.error) { bar.textContent = r.error; btn.disabled = false; return; }
            setStatus(`${f.file} downloaded.`); panel.close(); await refreshLlamaModels();
          } catch (err) { bar.textContent = err.message; btn.disabled = false; } finally { off(); }
        };
        return el('div', { class: 'line llama-file-row' }, btn, bar);
      };
      const repoRow = (r, mySeq) => {
        const filesBox = el('div', { class: 'llama-repo-files' }); filesBox.style.display = 'none';
        const toggle = el('button', { class: 'linklike' }, `${r.repo} — ${r.downloads.toLocaleString()} downloads`);
        toggle.onclick = async () => {
          const show = filesBox.style.display === 'none';
          filesBox.style.display = show ? 'block' : 'none';
          if (show && !filesBox.childNodes.length) {
            filesBox.append(el('div', { class: 'hint', text: 'Loading files…' }));
            const files = await api.llamamodels.listRepoFiles(r.repo);
            if (mySeq !== seq) return;
            filesBox.replaceChildren(...(files.error ? [el('div', { class: 'hint', text: files.error })]
              : files.length ? files.map((f) => fileRow(r.repo, f)) : [el('div', { class: 'hint', text: 'No .gguf files in this repo.' })]));
          }
        };
        return el('div', { class: 'llama-repo-row' }, toggle, filesBox);
      };
      const search = async () => {
        const query = q.value.trim();
        const mySeq = ++seq;
        if (!query) { results.replaceChildren(el('div', { class: 'hint', text: 'Type to search Hugging Face.' })); return; }
        results.replaceChildren(el('div', { class: 'hint', text: 'Searching…' }));
        const repos = await api.llamamodels.search(query);
        if (mySeq !== seq) return; // a newer search started meanwhile - drop this stale result
        results.replaceChildren(...(repos.error ? [el('div', { class: 'hint', text: repos.error })]
          : repos.length ? repos.map((r) => repoRow(r, mySeq)) : [el('div', { class: 'hint', text: 'No results.' })]));
      };
      async function downloadFromUrl(url) {
        const m = /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+\.gguf)$/i.exec(String(url || '').trim());
        if (!m) { setStatus('That does not look like a Hugging Face .gguf file URL (expected …/resolve/main/file.gguf).'); return; }
        const r = await api.llamamodels.download({ repo: m[1], file: m[2] });
        if (r && r.error) { setStatus(r.error); return; }
        setStatus(`${m[2]} downloaded.`); panel.close(); await refreshLlamaModels();
      }
      q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(search, 400); });
      const panel = overlayPanel('Download a GGUF model', el('div', { class: 'llama-download-panel' }, q, results, el('div', { class: 'line' }, urlField, urlBtn)));
      search();
    }
    refreshLlamaModels(); refreshLlamaStatus();
    const warmOn = el('input', { type: 'checkbox' }); warmOn.checked = ol.keepWarm !== false;
    const unloadOn = el('input', { type: 'checkbox' }); unloadOn.checked = ol.unloadOthers !== false;
    const noThinkOn = el('input', { type: 'checkbox' }); noThinkOn.checked = ol.noThink !== false;
    const repairOn = el('input', { type: 'checkbox' }); repairOn.checked = ol.repair !== false;
    const leanOn = el('input', { type: 'checkbox' }); leanOn.checked = ol.lean !== false;
    const restrictOn = el('input', { type: 'checkbox' }); restrictOn.checked = ol.restrictTools !== false;
    const hooksOn = el('input', { type: 'checkbox' }); hooksOn.checked = settings.agentHooks !== false;
    const testMin = el('input', { type: 'text', value: String(ol.testMinutes || 15), title: 'How long the model test waits for each step before giving up' }); testMin.style.maxWidth = '40px';
    const maxOut = el('input', { type: 'text', value: String(ol.maxOutputTokens || 8192), title: 'The most Claude Code lets a local model write in one reply. It is taken out of the context window, so a smaller number leaves more room for the conversation.' }); maxOut.style.maxWidth = '60px';
    const warmFor = el('input', { type: 'text', value: ol.keepAlive || '15m', title: 'How long Ollama keeps the model after each ping, e.g. 15m or 2h' }); warmFor.style.maxWidth = '60px';
    // ---- fields, keyed by name (not position): a new field only needs a key here and a mention in TABS below,
    // so adding one can never silently shift another field into the wrong tab or out of the dialog entirely.
    const f = {
      title: el('h3', { text: 'Settings' }),
      theme: el('div', { class: 'field' }, el('label', { text: 'Theme' }), themeSel,
        customThemeBox,
        el('div', null, el('button', { onclick: () => openThemeEditor(null) }, ic('palette'), 'Create custom theme…'))),
      shell: el('div', { class: 'field' }, el('label', { text: 'Terminal shell' }), shell),
      shellArgs: el('div', { class: 'field' }, el('label', { text: 'Shell arguments' }), shellArgs),
      agentButtons: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Agent buttons (top bar)' }), agentBox,
        el('div', { class: 'line' }, el('label', { text: 'Ollama server' }), urlIn),
        urlNote,
        el('div', { class: 'line' },
          presetSel,
          el('button', { onclick: () => { agents.push({ name: '', command: '' }); drawAgents(); } }, ic('plus'), 'Add agent')),
        el('label', { class: 'check', title: 'Loads a local model when you start its agent and pings it every 3 minutes while its terminal is open, so Ollama does not unload it after 5 idle minutes' }, warmOn, ' Keep local models loaded while their terminal is open, for ', warmFor),
        el('label', { class: 'check', title: 'A laptop cannot hold two models: other models loaded in Ollama (on this machine only, and not those of terminals still open) are unloaded before yours is loaded' }, unloadOn, ' Unload other models from this machine\'s Ollama before loading yours'),
        el('label', { class: 'check', title: 'qwen3 models think at length before every answer, which on a laptop can take minutes. /no_think, added to the standing instructions, tells them not to.' }, noThinkOn, ' Turn off qwen3 thinking (adds /no_think to the instructions)'),
        el('label', { class: 'check', title: 'Claude Code talks to the model through a small helper inside Bazinga. When the model prints a tool call as text, or uses wrong argument names or a relative path, the helper turns it into a correct tool call.' }, repairOn, ' Repair tool calls of local models (printed as text, wrong argument names, relative paths)'),
        el('label', { class: 'check', title: 'Claude Code sends tens of thousands of characters of instructions with every request. A local model has to read them again each time. This sends it a short version instead, with your standing instructions.' }, leanOn, ' Send local models a slimmer prompt (much faster, fewer tools explained)'),
        el('label', { class: 'check', title: 'Claude Code tells Bazinga itself when it has finished (Stop hook) or needs permission (Notification hook), through a settings file added with --settings and a server on 127.0.0.1. Workflows no longer depend on guessing from a quiet terminal. The guess stays as a fallback.' }, hooksOn, ' Claude Code reports when it is done (hooks)'),
        el('label', { class: 'check', title: 'Adds --tools Read,Write,Edit,Bash,Glob,Grep, --disable-slash-commands and --strict-mcp-config to Claude Code on a local model, whatever an older saved button says. Without it a small model can load skills and start subagents of its own, which takes hours.' }, restrictOn, ' Local models get only file and shell tools: no skills, subagents or MCP servers'),
        el('label', { class: 'check', title: 'How long the Test button waits for each step' }, ' Model test waits up to ', testMin, ' minutes per step'),
        el('label', { class: 'check', title: 'Claude Code reserves this much of the context window for the model\'s reply (it assumes 32000 for models it does not know, which leaves a 32k window almost empty). At most a quarter of the window is used.' }, ' Longest reply of a local model: ', maxOut, ' tokens (a smaller number leaves more room for files)'),
        el('div', { class: 'hint', text: 'Claude Code on a local model also gets settings that make it behave (no calls to Anthropic, all model aliases on your model, the real context size, long timeouts). Local-model buttons are checked before they start: Ollama running, model installed, context at least 32k. Standing instructions per agent are written to a file and passed with --append-system-prompt-file.' }),
        el('div', { class: 'agent-head', text: 'llama.cpp (runs inside Bazinga)' }),
        el('div', { class: 'line' }, llamaModelSel, llamaStartBtn, llamaDownloadBtn),
        llamaStatusLine,
        el('div', { class: 'hint', text: 'Bazinga starts and stops llama-server itself and gives it one downloaded model at a time. Changing the picked model while it is running has no effect until you Stop and Start again - llama.cpp runs one model per process, it cannot swap a running one.' })),
      reviewCommand: el('div', { class: 'field' }, el('label', { text: 'Review command (the review prompt is piped to its stdin)' }), review,
        el('label', { text: 'Review rules (all projects). A REVIEW.md in the project root is added after these.' }), rulesIn,
        el('div', null, el('button', { title: 'Free and private, but a small local model reviews less well than Claude', onclick: () => { review.value = 'ollama run qwen3.5'; } }, ic('cpu'), 'Use a local model (ollama run)'))),
      autoCheck: el('div', { class: 'field' }, el('label', { class: 'check' }, auto, ' Run fast checks automatically when files change')),
      humanInLoop: el('div', { class: 'field' }, headWithHelp('Human in the loop', 'How much the agent may do on its own. Lower levels make it ask or explain more before and after it works. Pick one and the detailed settings below follow it.'), lvlSel, lvlHint),
      fixLoop: el('div', { class: 'field' }, headWithHelp('Fix loop', 'When the agent goes quiet, Bazinga runs your checks (lint, tests). If something fails it sends the problems back to the agent so it fixes them, a few rounds at most.'),
        el('label', { class: 'check' }, flOn, ' When an agent goes quiet, run the gates and send the findings back to it'),
        el('div', { class: 'line wrap' }, 'At most ', flRounds, ' rounds · quiet for ', flIdle, ' seconds · fix ', flInclude),
        el('div', { class: 'line wrap' }, 'Still failing after ', flEscAfter, ' rounds? Hand the run over to ', flEsc),
        el('div', { class: 'hint', text: 'The stronger agent starts in the same working copy with the task, what the first one changed and the problems that remain. Once per run, and never for workflow steps or compared runs. A cloud agent costs money: this is where you choose to spend it.' }),
        el('label', { class: 'check', title: 'Runs only when the static gates are clean. Failures go back to the agent with the output tail.' }, flTests, ' Also run the tests related to the changed files (max 5 files, ', flTestSec, ' s each)'),
        el('div', { class: 'hint', text: 'Stops early when a round changes nothing (same findings, same test output). Your own typing in the terminal resets the round counter.' })),
      mergeGuard: el('div', { class: 'field' }, headWithHelp('Merge guard', 'A last check before an agent’s work is merged into your branch: protected files touched, tests weakened, a bug fix without a test. “block” means you must tick an extra box to merge anyway.'),
        el('div', { class: 'guard-grid' }, ...Object.entries(GUARD_LABELS).flatMap(([k, label]) => [el('span', { text: label }), guardSel[k]])),
        el('div', { class: 'hint', text: '“block” needs an explicit “merge anyway” tick in the merge dialog.' }),
        guardSuggestBox,
        guardCountsBox),
      autoMerge: el('div', { class: 'field' }, headWithHelp('Auto-merge', 'Once the fix loop gets the gates fully clean, merge without asking - but only for an agent and kind of task with a strong, proven track record in the scorecard. Off by default: this skips the review queue.'),
        el('label', { class: 'check' }, amOn, ' Merge automatically when the gates are clean and this agent has a strong track record for this kind of task'),
        el('div', { class: 'line wrap' }, 'Needs at least ', amRate, '% wins, with enough runs recorded in the scorecard'),
        el('label', { class: 'check', title: 'Logs what would have been auto-merged, and why, without actually merging - a way to build trust in the feature before turning it on for real.' }, amDry, ' Dry run: log it instead of merging'),
        el('div', { class: 'line wrap', title: 'Leave every box checked to auto-merge any kind of task (today’s behaviour).' }, 'Kinds of task it may auto-merge: ',
          ...Object.entries(KIND_LABELS).flatMap(([k, label]) => [el('label', { class: 'check' }, amKindSel[k], ` ${label}`)])),
        amHint,
        el('div', { class: 'hint', text: 'You can always undo an auto-merge afterwards from the run list.' })),
      taskTemplates: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Task templates (all projects)' }), tplIn,
        el('div', { class: 'hint', text: 'Shown in “New agent run”. A project can add or replace templates (same name) in .ide/tasks.md.' })),
      agentSafety: el('div', { class: 'field' }, headWithHelp('Agent safety', 'Limits what an agent can see. Hiding credentials is on by default. A Docker container goes further: the agent only sees its own run folder.'),
        el('label', { class: 'check' }, scrubOn, ' Start agent terminals without credentials from your environment (tokens, secrets, passwords, cloud keys)'),
        scrubAllow,
        el('label', { class: 'check' }, ccOn, ' Run agent runs in a Docker container (sees only the run’s folder and the repository’s git data)'),
        el('div', { class: 'line wrap' }, el('button', { id: 'cc-setup', title: 'Looks for Docker and the image, and builds it from the files shipped with Bazinga', onclick: async (ev) => {
          const btn = ev.currentTarget; const st = $('#cc-status'); btn.disabled = true;
          try {
            let r = await api.container.setup({ image: ccImage.value.trim() || undefined });
            st.textContent = r.error || r.text;
            if (!r.error && r.step === 'build' && window.confirm('Build the agent image now? It downloads Node, a JDK and Claude Code and takes a few minutes.')) {
              st.textContent = 'Building the image… (a few minutes; the window stays usable)';
              r = await api.container.setup({ action: 'build', image: ccImage.value.trim() || undefined });
              st.textContent = r.error || r.text;
            }
            if (!r.error && r.ok) ccOn.checked = true;
          } finally { btn.disabled = false; }
        } }, ic('package'), 'Check Docker / build the image…'), el('span', { id: 'cc-status', class: 'hint' })),
        el('div', { class: 'line wrap' }, 'Image ', ccImage, ' · ', ccNet, ' · memory ', ccMem, ' · cpus ', ccCpu),
        el('div', { class: 'line wrap' }, 'Pass these variables in: ', ccEnv),
        el('div', { class: 'hint', text: 'The button above builds the image (or by hand: docker build -t bazinga-agent:latest docker/agent). Log in to the agent inside the container once (kept in a Docker volume), or pass an API key variable. Applies to “New agent run”; the toolbar agent buttons still run on your machine. A container does not protect the repository’s git data or what the agent sends over the network.' }),
        el('div', { class: 'line' }, 'Time budget per run: ', budgetIn, ' minutes of active agent work (0 = unlimited)'),
        el('div', { class: 'hint', text: 'When the budget is used you are notified and the fix loop stops for that run. Your own shells are never scrubbed.' })),
      languageServers: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Language servers (optional)' }),
        el('label', { class: 'check' }, lspOn, ' Hover, go to definition, find references, completion and diagnostics from installed language servers'),
        ...Object.entries(lspCmd).map(([name, input]) => el('div', { class: 'line' }, el('span', { class: 'lsp-name', text: name }), input)),
        el('div', { class: 'hint', text: 'Nothing is bundled: install the server (e.g. jdtls for Java, pyright for Python, typescript-language-server for TS/JS, gopls for Go, rust-analyzer for Rust, csharp-ls for C#) and it is found on your PATH. Leave a field empty for the default command.' })),
      aiCompletion: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'AI inline completion (optional)' }),
        el('label', { class: 'check' }, icOn, ' Suggest ghost-text completions as you type, from a local model'),
        el('div', { class: 'line' }, 'Ollama server ', icBaseUrl, ' model ', icModel),
        el('div', { class: 'line' }, 'Wait before asking (ms) ', icDebounce),
        el('div', { class: 'hint', text: 'Ollama only, fill-in-the-middle (codellama/qwen2.5-coder/starcoder-style models give the best results; others still work, just less precisely mid-function). Leave the server/model blank to use the first agent in Settings → Agents that already points at an Ollama server. Tab accepts a suggestion, Esc dismisses it.' })),
      codeLenses: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Above classes and methods' }),
        el('label', { class: 'check' }, lensUsages, ' Show how often the name is used in the project'),
        el('label', { class: 'check' }, lensBlame, ' Show who changed it last (git blame of its lines); click opens the commit'),
        el('label', { class: 'check' }, lensSpring, ' Java/Kotlin: show the HTTP route above Spring handlers and “N implementations” above interfaces')),
      errorLens: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Diagnostics' }),
        el('label', { class: 'check' }, elOn, ' Error lens: show each diagnostic inline at the end of its line, not only as a squiggly underline')),
      minimap: el('div', { class: 'field' }, el('div', { class: 'agent-head', text: 'Minimap' }),
        el('label', { class: 'check' }, minimapOnInput, ' Show the code minimap on the right edge of the editor')),
      keyboard: el('div', { class: 'field' }, headWithHelp('Keyboard shortcuts', 'Click a shortcut, then press the new key combination. Escape cancels. A shortcut shared by two commands is flagged, but nothing stops you using it anyway.'),
        kbRows,
        el('div', { class: 'hint', text: 'These are your personal defaults, same as theme and font. A project can override one in .ide/config.json.' })),
      notifications: el('div', { class: 'field' }, el('label', { class: 'check' }, notif, ' Notify me (OS notification) when an agent needs me and the IDE is in the background')),
      fontSize: el('div', { class: 'field' }, el('label', { text: 'Font' }), el('div', { class: 'line' }, fontFam), el('label', { text: 'Font size (px): editor / terminal' }), el('div', { class: 'line' }, edFont, termFont)),
      scrollback: el('div', { class: 'field' }, el('label', { text: 'Terminal scrollback (lines kept per terminal; each one costs memory)' }), scrollback),
      checkpoint: el('div', { class: 'field' }, el('label', { class: 'check' }, cp, ' Save a checkpoint before an agent terminal starts')),
      footnote: el('div', { class: 'hint', text: 'These are your personal defaults. A project’s .ide/config.json overrides them.' }),
      actions: el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: save }, ic('check'), 'Save')),
    };
    // ---- tabs: related settings together; every control stays in the DOM, so Save reads all of them whichever tab is open
    const TABS = [
      ['general', 'General', ['theme', 'fontSize', 'scrollback', 'notifications', 'shell', 'shellArgs'], 'settings'],
      ['agents', 'Agents', ['agentButtons', 'taskTemplates', 'checkpoint'], 'bot'],
      ['review', 'Review & checks', ['reviewCommand', 'autoCheck'], 'shield-check'],
      ['oversight', 'Oversight', ['humanInLoop', 'fixLoop', 'mergeGuard', 'autoMerge'], 'eye'],
      ['safety', 'Safety', ['agentSafety'], 'lock'],
      ['editor', 'Editor', ['languageServers', 'aiCompletion', 'codeLenses', 'errorLens', 'minimap'], 'file-code'],
      ['keyboard', 'Keyboard', ['keyboard'], 'command'],
    ];
    const used = new Set(TABS.flatMap((t) => t[2]).concat(['title', 'footnote', 'actions']));
    const stray = Object.keys(f).filter((k) => !used.has(k));
    if (stray.length) throw new Error(`Settings field(s) not assigned to a tab: ${stray.join(', ')}.`);
    let tabId = 'general';
    try { const saved = localStorage.getItem('bazinga.settingsTab'); if (TABS.some((t) => t[0] === saved)) tabId = saved; } catch { /* no storage */ }
    const panels = new Map(TABS.map(([id, , keys]) => [id, el('div', { class: 'set-panel', id: `set-panel-${id}`, role: 'tabpanel' }, ...keys.map((k) => f[k]))]));
    const tabBtns = new Map();
    const showTab = (id) => {
      tabId = id;
      for (const [k, btn] of tabBtns) { btn.classList.toggle('active', k === id); btn.setAttribute('aria-selected', String(k === id)); }
      for (const [k, panel] of panels) panel.classList.toggle('hidden', k !== id);
      try { localStorage.setItem('bazinga.settingsTab', id); } catch { /* ignore */ }
    };
    for (const [id, label, , icon] of TABS) tabBtns.set(id, el('button', { class: 'set-tab', role: 'tab', id: `set-tab-${id}`, onclick: () => showTab(id) }, ic(icon), label));
    const tabBar = el('div', { class: 'set-tabs', role: 'tablist' }, ...tabBtns.values());
    tabBar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = TABS.map((t) => t[0]);
      const next = ids[(ids.indexOf(tabId) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      showTab(next); tabBtns.get(next).focus();
    });
    $('#dialog').replaceChildren(f.title, tabBar, el('div', { class: 'set-body' }, ...panels.values()), f.footnote, f.actions);
    showTab(tabId);
    $('#modal').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- custom theme editor (3 seed colours -> a full
  // palette via api.theme.derive, src/core/custompalette.js). Opened from Settings -> General; Save/Cancel both
  // return to a freshly reloaded Settings dialog, so any other field mid-edit there is lost - an accepted trade-off
  // for keeping "create a theme" a small, immediate, independently-saved action (see the plan this was built from).
  function previewCustomTheme(vars, dark) {
    document.documentElement.dataset.theme = 'custom';
    document.documentElement.style.colorScheme = dark === false ? 'light' : 'dark';
    applyCustomVars(vars);
    if (window.monaco) { const name = ensureMonacoCustomTheme('preview', vars); window.monaco.editor.setTheme(name); } // Monaco theme names must match /^[a-z0-9-]+$/, no underscores
    const term = buildTermTheme(vars);
    for (const entry of state.terms.values()) entry.term.options.theme = term;
  }
  async function openThemeEditor(existing) {
    const seed = existing ? existing.seed || { bg: existing.vars['--bg'], fg: existing.vars['--fg'], accent: existing.vars['--accent'] }
      : { bg: '#14161a', fg: '#d7dae0', accent: '#4f8cff' };
    const labelIn = el('input', { type: 'text', value: existing ? existing.label : '', placeholder: 'Name this theme' });
    const bgIn = el('input', { type: 'color', value: seed.bg });
    const fgIn = el('input', { type: 'color', value: seed.fg });
    const accentIn = el('input', { type: 'color', value: seed.accent });
    const darkChk = el('input', { type: 'checkbox' }); darkChk.checked = existing ? existing.dark !== false : true;
    let derived = existing ? { dark: existing.dark, vars: { ...existing.vars } } : null;
    let overrides = {};
    const effectiveVars = () => (derived ? { ...derived.vars, ...overrides } : {});
    const reportBox = el('div', { class: 'hint' });
    const fineBox = el('div', { class: 'hidden' });
    const fineDetails = el('details', null, el('summary', { text: 'Fine-tune the generated colours' }), fineBox);
    const FINE_KEYS = ['--bg', '--bg-2', '--bg-3', '--line', '--fg', '--muted', '--faint', '--accent', '--err', '--warn', '--info', '--ok', '--accent-bg', '--accent-line', '--danger-line', '--err-bg', '--warn-bg', '--ok-bg', '--info-bg', '--g0', '--g1', '--g2', '--g3', '--g4', '--g5'];
    function drawFineTune() {
      const vars = effectiveVars();
      fineBox.replaceChildren(...FINE_KEYS.map((k) => {
        const input = el('input', { type: 'color', value: vars[k] || '#000000' });
        input.addEventListener('input', () => { overrides[k] = input.value; preview(); });
        return el('div', { class: 'line' }, el('span', { style: 'width:140px;display:inline-block', text: k.slice(2) }), input);
      }));
    }
    async function refreshContrast() {
      const vars = effectiveVars();
      if (!vars['--bg']) { reportBox.textContent = ''; return; }
      const { allPass, pairs } = await api.theme.contrast(vars);
      if (allPass) { reportBox.textContent = 'Every text colour clears 4.5:1 contrast on every background.'; return; }
      const bad = pairs.filter((p) => !p.pass);
      reportBox.textContent = `${bad.length} pairing${bad.length === 1 ? '' : 's'} below the 4.5:1 contrast bar: ${bad.map((p) => `${p.fg.slice(2)} on ${p.bg.slice(2)} (${p.ratio.toFixed(1)}:1)`).join(', ')}.`;
    }
    let debounceTimer = null;
    function preview() { previewCustomTheme(effectiveVars(), darkChk.checked); refreshContrast(); }
    function recompute() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        derived = await api.theme.derive({ bg: bgIn.value, fg: fgIn.value, accent: accentIn.value, dark: darkChk.checked });
        overrides = {};
        drawFineTune();
        preview();
      }, 120);
    }
    for (const input of [bgIn, fgIn, accentIn]) input.addEventListener('input', recompute);
    darkChk.addEventListener('change', recompute);
    const close = async () => { applyTheme(); await openSettings(); };
    const save = async () => {
      const label = labelIn.value.trim();
      if (!label) { reportBox.textContent = 'Give this theme a name first.'; return; }
      if (!derived) return;
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
      const id = existing ? existing.id : `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
      const theme = { id, label, dark: darkChk.checked, seed: { bg: bgIn.value, fg: fgIn.value, accent: accentIn.value }, vars: effectiveVars() };
      const cur = await api.settings.get();
      const list = (cur.settings.customThemes || []).filter((c) => c.id !== id);
      list.push(theme);
      await api.settings.save({ ...cur.settings, customThemes: list, theme: id });
      await loadProject();
      await openSettings();
    };
    if (!existing) recompute(); else { drawFineTune(); refreshContrast(); previewCustomTheme(effectiveVars(), darkChk.checked); }
    $('#dialog').replaceChildren(
      el('h3', { text: existing ? 'Edit custom theme' : 'Create custom theme' }),
      el('div', { class: 'field' }, el('label', { text: 'Name' }), labelIn),
      el('div', { class: 'field' }, el('label', { text: 'Seed colours' }),
        el('div', { class: 'line' }, el('span', { text: 'Background' }), bgIn, el('span', { text: 'Text' }), fgIn, el('span', { text: 'Accent' }), accentIn),
        el('label', { class: 'check' }, darkChk, ' Dark theme (light text on a dark background)'),
        el('div', { class: 'hint', text: 'Everything else - surfaces, muted text, errors/warnings/success, the commit graph lanes - is generated from these three, and nudged automatically to keep text readable.' })),
      reportBox,
      el('div', { class: 'field' }, fineDetails),
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: save }, ic('check'), 'Save theme')));
    $('#modal').classList.remove('hidden');
    // Save/Cancel both go straight from this dialog's content to Settings' while the modal stays visible, so this
    // only fires if something else dismisses the modal outright (e.g. a backdrop click) while the preview is live -
    // otherwise the real theme's vars/monaco/terminal theme would be stuck showing this preview indefinitely.
    const modalObserver = new MutationObserver(() => {
      if ($('#modal').classList.contains('hidden')) { applyTheme(); modalObserver.disconnect(); }
    });
    modalObserver.observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
  }

  // ---------------------------------------------------------------- session (tabs, layout, toggles) + status bar + chrome
  let sessionTimer = null;
  let restoring = false;
  function sessionPayload() {
    const cs = getComputedStyle(document.documentElement);
    return {
      ui: { sideW: cs.getPropertyValue('--side-w').trim(), bottomH: cs.getPropertyValue('--bottom-h').trim() },
      project: {
        tabs: state.tabs.filter((t) => !t.ro && t.kind !== 'rest').map((t) => ({ kind: t.kind, rel: t.rel, pinned: !!t.pinned })),
        active: (state.tabs.find((t) => t.id === state.activeTab && !t.ro && t.kind !== 'rest') || {}).id || null,
        expanded: [...state.expanded],
        sideTab: state.sideTab,
        onlyMine: state.onlyMine,
        autoCheck: state.autoCheck,
        task: state.task,
        // pending review comments: where they are and the text of that line, so they can be re-attached after a restart
        comments: [...state.comments.values()].map((c) => { const line = commentLine(c); const m = state.models.get(c.rel); return line && m ? { rel: c.rel, line, text: c.text, code: m.model.getLineContent(line) } : null; }).filter(Boolean),
        terminals: [...state.terms.values()].filter((t) => t.persist && !t.exited).map((t) => ({ title: t.title, cwd: t.cwd, agent: t.agent, runId: t.runId, container: !!t.sandboxed, exited: t.exited })),
        bookmarks: allBookmarks(),
      },
    };
  }
  function saveSessionNow() {
    clearTimeout(sessionTimer);
    if (restoring || api.smoke || !state.project || !state.project.root) return Promise.resolve();
    return api.session.save(sessionPayload());
  }
  function scheduleSessionSave() {
    if (restoring || api.smoke) return;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => { if (state.project && state.project.root) api.session.save(sessionPayload()); }, 500);
  }

  async function restoreSession(sess, { skipTerminals = false } = {}) {
    if (!sess) return;
    restoring = true;
    try {
      for (const e of sess.expanded || []) state.expanded.add(e);
      if (sess.expanded && sess.expanded.length) await renderTree();
      for (const b of sess.bookmarks || []) { if (b && b.rel && Number.isInteger(b.line)) bmSet(b.rel).add(b.line); } // painted lazily as each file opens (ensureModel)
      if (typeof sess.onlyMine === 'boolean') state.onlyMine = sess.onlyMine;
      if (typeof sess.autoCheck === 'boolean') { state.autoCheck = sess.autoCheck; $('#auto').checked = sess.autoCheck; }
      if (sess.task && typeof sess.task === 'object') {
        state.task = { allow: '', summary: '', baseline: null, reviewed: {}, started: null, ...sess.task };
        $('#t-allow').value = state.task.allow || ''; $('#t-summary').value = state.task.summary || '';
        await refreshChanges();
      }
      if (sess.sideTab) setSideTab(sess.sideTab);
      for (const t of sess.tabs || []) {
        try {
          if (t.kind === 'diff') { if (state.changes.some((c) => c.path === t.rel)) await openDiff(t.rel); } else await openFile(t.rel);
          if (t.pinned) { const opened = state.tabs.find((x) => x.id === `${t.kind}:${t.rel}`); if (opened) opened.pinned = true; }
        } catch { /* file vanished */ }
      }
      renderTabs();
      if (sess.active && state.tabs.some((t) => t.id === sess.active)) await activateTab(sess.active);
      if (Array.isArray(sess.comments) && sess.comments.length) {
        try { for (const c of await api.review.anchor(sess.comments)) addCommentAt(c.rel, c.line, c.text); } catch { /* comments are a convenience: never block the restore */ }
      }
      if (!skipTerminals) {
        for (const t of sess.terminalPlan || []) {
          const entry = await newTerminal({ title: t.title, cwd: t.cwd, initialInput: t.initialInput, env: t.env, inlineEnv: t.watch ? t.env : undefined, watch: !!t.watch, label: t.label, runId: t.runId, agent: t.agent, persist: true });
          if (entry && t.note) entry.term.write(`\x1b[33m${t.note}\x1b[0m\r\n`);
        }
      }
      if (state.terms.size) showBottom('problems');
    } finally { restoring = false; }
  }

  function setStatus(text) { $('#status-left').textContent = text; }

  function updateStatus() {
    const p = state.project;
    const c = countOf(visibleFindings());
    let right = p && p.branch ? `⎇ ${p.branch}` : '';
    if (state.lastResult && state.lastResult.findings) right += `${right ? '   ' : ''}${c.error} error${c.error === 1 ? '' : 's'} · ${c.warning} warning${c.warning === 1 ? '' : 's'}`;
    $('#status-right').textContent = right;
    const ov = p && p.oversight;
    const ovEl = $('#status-oversight');
    if (ovEl) {
      ovEl.textContent = ov && ov.level ? `◉ ${ov.label}` : '';
      ovEl.title = ov && ov.level ? `Human-in-the-loop level: ${ov.label} (${ov.source === 'project' ? 'set by this project' : 'your IDE setting'}). ${ov.summary}` : '';
    }
  }

  function setButtons() {
    const has = !!(state.project && state.project.root);
    for (const id of ['btn-fast', 'btn-all']) $(`#${id}`).disabled = !has || state.checksRunning;
    $('#btn-term').disabled = !has;
    $('#btn-review').disabled = !has;
    setLabel($('#btn-review'), state.review.running ? 'Cancel review' : 'AI review', state.review.running ? 'square' : 'sparkles');
    for (const b of document.querySelectorAll('#agents button')) b.disabled = !has;
  }

  // Local-model buttons show the model they run (qwen3:8b), not a generic "local" label.
  function modelOf(command) {
    const m = /--model[ =]["']?([^\s"']+)/.exec(command || '');
    return m ? m[1].replace(/^ollama(_chat)?\//, '') : '';
  }
  function agentLabel(a) {
    const model = modelOf(a.command);
    if (!a.name || (model && /^(Claude|Aider) \(local\)$/.test(a.name))) return model || a.name || '';
    return a.name;
  }

  // Toolbar agent buttons tint their icon by which known CLI they launch, so the cluster
  // isn't four identical bot icons differing only in label text. Unknown/local-model/custom
  // agents fall through to the default accent color, same as before.
  function agentKind(a) {
    const cmd = (a.command || '').toLowerCase();
    if (/^claude\b/.test(cmd)) return 'claude';
    if (/^copilot\b/.test(cmd)) return 'copilot';
    if (/^codex\b/.test(cmd)) return 'codex';
    if (/^gemini\b/.test(cmd)) return 'gemini';
    return '';
  }

  // Standing instructions for small local models: they drop tool arguments and try tools they cannot use.
  const LOCAL_HINT = 'Tool rules: always pass every required argument, spelled exactly: Read needs file_path. Write needs file_path and content. Edit needs file_path, old_string and new_string. Bash needs command. Glob and Grep need pattern. file_path is the full absolute path, built from the working directory (create parent folders with Bash first when they do not exist). Never call a tool without all of its required arguments. If you do not know a path, list the directory first. If a tool call fails with invalid parameters, read the error and call it again with the corrected arguments.';
  const localClaudeCmd = (model) => `claude --model ${model} --tools Read,Write,Edit,Bash,Glob,Grep`; // few tools: a small model picks and formats calls better, and the web tools it cannot use are gone
  const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
  const localEnv = (url) => ({ ANTHROPIC_BASE_URL: url || DEFAULT_OLLAMA_URL, ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' });
  // Same rule as core/ollama.js isModelServerUrl: this machine, the local network, or Ollama's port; never Anthropic's API.
  function isModelServerUrl(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (/(^|\.)anthropic\.com$/.test(h)) return false;
    if (u.port === '11434' || h === 'localhost' || h === '::1' || /^127\./.test(h)) return true;
    return /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /\.(local|lan|home|internal)$/.test(h) || !h.includes('.');
  }
  // What was typed in the "Ollama server" box -> a base URL ("gpu-box" and "192.168.1.20" work; the default port is added).
  function normalizeServerUrl(text) {
    const t = String(text || '').trim().replace(/\/+$/, '');
    if (!t) return DEFAULT_OLLAMA_URL;
    try { const u = new URL(/^https?:\/\//i.test(t) ? t : `http://${t}`); return `${u.protocol}//${u.host}${u.protocol === 'http:' && !u.port ? ':11434' : ''}`; } catch { return DEFAULT_OLLAMA_URL; }
  }
  function isRemoteUrl(url) {
    try { const h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); return !(h === 'localhost' || h === '::1' || /^127\./.test(h)); } catch { return false; }
  }
  function isLocalAgent(a) {
    return isModelServerUrl((a && a.env && (a.env.ANTHROPIC_BASE_URL || a.env.OLLAMA_API_BASE)) || '');
  }

  // Before an agent starts: its standing instructions become a file, a local model is checked and loaded. null = the user cancelled.
  async function prepareAgent(agent, retried = false, noHooks = false) {
    if (isLocalAgent(agent)) setStatus(`Checking ${agentLabel(agent)} on Ollama (loading it if needed)…`);
    let r;
    try { r = await api.agent.prepare(agent, { noHooks, inUse: [...state.terms.values()].filter((t) => !t.exited && t.local && t.local.model).map((t) => t.local.model) }); } catch { return { command: agent.command, taskCommand: agent.taskCommand, local: null }; }
    const probs = (r.local && r.local.problems) || [];
    const missing = probs.find((p) => p.kind === 'missing-model');
    if (missing && !retried && !r.local.remote && SAFE_MODEL.test(r.local.model)) {
      // not installed: offer the download instead of starting an agent that can only fail
      if (!window.confirm(`${agentLabel(agent)}\n\nThe model “${r.local.model}” is not installed on this machine.\n\nDownload it now (ollama pull ${r.local.model})? The agent starts when the download is done.`)) { setStatus('Agent not started.'); return null; }
      if (!(await downloadModel(r.local))) return null;
      return prepareAgent(agent, true, noHooks);
    }
    if (probs.length) {
      if (!window.confirm(`${agentLabel(agent)}\n\n${probs.map((p) => `• ${p.text}`).join('\n\n')}\n\nStart it anyway?`)) { setStatus('Agent not started.'); return null; }
    }
    if (r.local) {
      const note = (r.local.notes || []).join(' ');
      setStatus(`${r.local.context ? `${agentLabel(agent)} is loaded (${r.local.contextLabel} context).` : `${agentLabel(agent)}: ready.`}${note ? ` ${note}` : ''}`);
    }
    return r;
  }
  const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._\-\/]*(:[A-Za-z0-9._\-]+)?$/; // typed into a shell: nothing but a model name

  // Runs `ollama pull` in a terminal and waits until Ollama lists the model. false = closed or timed out.
  async function downloadModel(local) {
    const entry = await newTerminal({ title: `ollama pull ${local.model}`, initialInput: `ollama pull ${local.model}\r`, persist: false });
    if (!entry) return false;
    const deadline = Date.now() + 2 * 3600 * 1000;
    while (Date.now() < deadline) {
      setStatus(`Downloading ${local.model}… the agent starts when it is done (progress is in the terminal).`);
      await new Promise((res) => setTimeout(res, 3000));
      if (entry.exited) { setStatus('The download terminal was closed: agent not started.'); return false; }
      let st = null;
      try { st = await api.ollama.list(local.baseUrl); } catch { /* keep waiting */ }
      if (st && st.installed.some((m) => m.name === local.model || m.name === `${local.model}:latest`)) { setStatus(`${local.model} downloaded.`); return true; }
    }
    setStatus('The download took too long: agent not started.');
    return false;
  }
  // A small panel on top of whatever is open (the settings dialog keeps its unsaved edits underneath).
  function overlayPanel(title, body, { onClose } = {}) {
    const back = el('div', { class: 'overlay-panel' });
    const close = () => { back.remove(); if (onClose) onClose(); };
    const button = el('button', { class: 'primary', onclick: close }, ic('check'), 'Close');
    back.append(el('div', { class: 'overlay-box' }, el('h3', { text: title }), body, el('div', { class: 'actions' }, button)));
    document.body.append(back);
    return { close, root: back, button };
  }

  // The model self-test: send a file, read one, write one. Checked on disk (see core/modeltest.js).
  // Shows each check live (waiting, running, passed, failed) with a timer: on a laptop it takes minutes.
  let modelTestPanel = null;
  async function testAgentModel(agent, runner) {
    if (modelTestPanel && modelTestPanel.root.isConnected) return modelTestPanel; // one test at a time: show the running one
    const run = runner || ((a, onProgress) => { const off = api.agent.onTestProgress(onProgress); return api.agent.test(a).finally(off); });
    const ROWS = [['prepare', 'Loading the model'], ['attach', 'Sending a file with @file'], ['write', 'Writing a file to disk'], ['read', 'Reading a file with its tool']];
    const rowEls = {};
    const setRow = (id, state, detail) => {
      let row = rowEls[id];
      if (!row) {
        row = rowEls[id] = { mark: el('span', { class: 'test-mark' }), detail: el('div', { class: 'hint' }), box: el('div', { class: 'test-step' }) };
        row.box.append(row.mark, el('div', null, el('strong', { text: (ROWS.find((r) => r[0] === id) || [id, id])[1] }), row.detail));
        steps.append(row.box);
      }
      row.box.className = `test-step ${state}`;
      row.mark.textContent = { wait: '·', running: '…', ok: '✓', bad: '✗' }[state] || '·';
      if (detail !== undefined) row.detail.textContent = detail;
    };
    const steps = el('div', { class: 'test-steps' });
    const timer = el('div', { class: 'hint' });
    const out = el('div', null, el('div', { class: 'hint', text: 'Three small checks against the model: send it a file, let it read one, let it write one. On a laptop this takes a few minutes, mostly loading the model and reading the prompt.' }), steps, timer);
    for (const [id] of ROWS) setRow(id, 'wait', 'Waiting');
    const t0 = Date.now();
    const tick = () => { timer.textContent = `Running for ${Math.round((Date.now() - t0) / 1000)}s…`; };
    tick();
    const clock = setInterval(tick, 1000);
    const panel = overlayPanel(`Test ${agentLabel(agent)}`, out, { onClose: () => { clearInterval(clock); if (!finished) api.agent.testCancel(); modelTestPanel = null; } });
    modelTestPanel = panel;
    panel.button.textContent = 'Cancel';
    let finished = false;
    const onProgress = (p) => { if (p && p.id) setRow(p.id, p.state === 'running' ? 'running' : p.ok ? 'ok' : 'bad', p.state === 'running' ? (p.detail || 'Running…') : p.detail); };
    let r;
    try { r = await run(agent, onProgress); } catch (e) { r = { error: String(e && e.message || e) }; }
    finished = true;
    clearInterval(clock);
    panel.button.textContent = 'Close';
    if (!panel.root.isConnected) return panel; // closed (and cancelled) meanwhile
    timer.remove();
    if (r.error) { steps.remove(); out.append(el('div', { class: 'hint', text: r.error })); return panel; }
    for (const st of r.steps) setRow(st.id, st.ok ? 'ok' : 'bad', st.detail);
    for (const [id] of ROWS) if (rowEls[id] && /^(wait|running)/.test(rowEls[id].box.className)) { setRow(id, 'wait', r.cancelled ? 'Cancelled' : 'Not run'); }
    out.insertBefore(el('div', { class: 'test-verdict', text: r.cancelled ? 'Cancelled.' : r.ok ? `Passed in ${r.seconds}s: this model can be sent a file, read it and write files.` : 'Not everything works with this model.' }), steps);
    if (r.server && r.server.contextLabel) out.append(el('div', { class: 'hint', text: `Model loaded with a ${r.server.contextLabel} context.${(r.server.notes || []).length ? ` ${r.server.notes.join(' ')}` : ''}` }));
    if (r.repairs && r.repairs.length) out.append(el('div', { class: 'test-advice' }, el('strong', { text: 'Bazinga repaired the model\'s output' }), ...r.repairs.map((x) => el('div', { text: `• ${x}` })), el('div', { class: 'hint', text: 'Without this repair the test would have failed: the model alone does not make correct tool calls. Switch it off in Settings → Agents to see the model unaided.' })));
    if (r.advice && r.advice.length) out.append(el('div', { class: 'test-advice' }, el('strong', { text: 'Likely cause' }), ...r.advice.map((a) => el('div', { text: `• ${a}` }))));
    if (r.output) out.append(el('details', null, el('summary', { text: 'What the model printed' }), el('pre', { class: 'test-output', text: r.output })));
    if (r.wire && r.wire.length) out.append(el('details', null, el('summary', { text: 'Behind the scenes (what went between Claude Code and the model)' }), el('pre', { class: 'test-output', text: r.wire.join('\n') })));
    return panel;
  }

  const withContext = (agent, r) => (r && r.local && r.local.contextLabel ? `${agentLabel(agent)} · ${r.local.contextLabel}` : agentLabel(agent));

  // Keeps local models loaded while their terminal is open (Ollama unloads a model after 5 idle minutes by default).
  function startKeepWarm() {
    if (state.warmTimer) return;
    state.warmTimer = setInterval(() => {
      for (const t of state.terms.values()) {
        if (t.exited || !t.local || !t.local.keepWarm || !t.local.model) continue;
        api.ollama.warm({ baseUrl: t.local.baseUrl, model: t.local.model, keepAlive: t.local.keepAlive }).catch(() => {});
      }
    }, 3 * 60 * 1000);
  }

  function renderAgents() {
    const agents = (state.project && state.project.config && state.project.config.agents) || [];
    $('#agents').replaceChildren(...agents.map((a) => el('button', {
      title: `Run “${a.command}” in a new terminal`, class: `agent-btn${agentKind(a) ? ` agent-${agentKind(a)}` : ''}`,
      onclick: async () => {
        const cfg = state.project && state.project.config;
        rememberAgent(a.name);
        const prep = await prepareAgent(a);
        if (!prep) return;
        if (cfg && cfg.autoCheckpoint && state.project.isRepo) await makeCheckpoint(`before ${a.name}`);
        const agentEnv = { ...(prep.env || {}), ...(a.env || {}), ...(prep.envForce || {}) }; // the agent's own settings win over the local-model defaults; the helper's address wins over both
        const entry = await newTerminal({ title: withContext(a, prep), env: agentEnv, inlineEnv: agentEnv, initialInput: `${prep.command}\r`, watch: true, label: withContext(a, prep), agent: a.name, persist: true });
        if (entry && prep.local) { entry.local = prep.local; startKeepWarm(); }
      },
    }, ic('bot'), agentLabel(a))));
  }

  // the short folder name of a workspace root, for UI labels (tree/search/changes/todos group headers)
  const rootName = (root) => ((state.project && state.project.roots || []).find((r) => r.root === root) || {}).name || (root || '').split(/[\\/]/).pop() || root;

  async function loadProject() {
    restCollection = null;
    loadSnippetsCache().catch(() => {});
    state.project = await api.project.get();
    const p = state.project;
    $('#project-name').textContent = p.root ? p.name : 'Open folder…';
    $('#project-name').parentElement.title = p.root || 'Open a project folder';
    $('#branch').textContent = p.branch ? `⎇ ${p.branch}` : p.root && !p.isRepo ? '(no git)' : '';
    if (p.configProblems && p.configProblems.length) { setStatus(`.ide/config.json: ${p.configProblems[0]}${p.configProblems.length > 1 ? ` (+${p.configProblems.length - 1} more, see the Debug log)` : ''}`); for (const t of p.configProblems) dbg('app', `.ide/config.json: ${t}`); }
    if (!updateUi.startupDone && !api.smoke && p.config && p.config.updates && p.config.updates.check) { updateUi.startupDone = true; api.updates.check().then((r) => { if (r && r.error) dbg('app', `update check: ${r.error}`); }); }
    state.autoCheck = !!(p.config && p.config.autoCheck);
    loadWorkflows().catch(() => {});
    showWatcher(p.watching !== false);
    $('#auto').checked = state.autoCheck;
    state.customThemes = (p.config && p.config.customThemes) || [];
    themeSetting = (p.config && p.config.theme) || 'system';
    applyTheme();
    $('#fixloop').checked = !!(p.config && p.config.fixLoop && p.config.fixLoop.enabled);
    applyFonts();
    refreshMinimap();
    initLsp();
    document.title = p.root ? `${p.name} — Bazinga` : 'Bazinga';
    state.quick.stale = true;
    renderAgents();
    renderScripts();
    refreshRuns();
    setButtons();
    await renderTree();
    await refreshChanges();
    refreshCheckpoints();
    if (p.root) scanTodos().catch(() => {});
    setStatus(p.error ? `Config problem: ${p.error}` : p.root || '');
  }

  async function resetWorkspace({ keepTerminals = false } = {}) {
    // let go of the models in the editors first: disposing a model that a diff editor still shows throws
    const oldTabs = [...state.tabs]; const oldModels = [...state.models.values()];
    state.tabs = []; state.models.clear(); state.expanded.clear(); state.comments.clear(); refreshCommentUi();
    await activateTab(null);
    closeSplit();
    for (const t of oldTabs) { if (t.original) t.original.dispose(); }
    for (const m of oldModels) m.model.dispose();
    if (!keepTerminals) {
      for (const t of [...state.terms.values()]) { if (t.id !== null && !t.exited) api.pty.kill(t.id); t.term.dispose(); t.container.remove(); }
      state.terms.clear();
      showBottom('problems');
    }
    state.lastResult = null;
    state.review = { used: false, running: false, output: '', error: '' };
    state.checkpoints = [];
    renderProblems();
  }

  // ---------------------------------------------------------------- agent runs (parallel agents in git worktrees)
  const shellKind = () => {
    const sh = String((state.project && state.project.config && state.project.config.shell) || '').toLowerCase();
    if (/powershell|pwsh/.test(sh)) return 'ps';
    if (/(^|[\\/])cmd(\.exe)?$/.test(sh)) return 'cmd';
    if (!sh && api.platform === 'win32') return 'ps';
    return 'posix';
  };
  const taskRef = () => ({ ps: '$env:BAZINGA_TASK', cmd: '%BAZINGA_TASK%', posix: '"$BAZINGA_TASK"' }[shellKind()]);

  /** The command line that starts `agent` with the task already given. null = the agent has no way to take a prompt on the command line. */
  function taskCommandFor(agent) {
    if (agent.taskCommand && agent.taskCommand.includes('{task}')) return taskFirst(agent.taskCommand);
    if (/^claude(\s|$)/.test(agent.command)) return taskFirst(`${agent.command} {task}`);
    return null;
  }

  /** A template's `<placeholder>` that is still in the task text (the agent would receive it literally). null = none left. */
  function unfilledPlaceholder(text, templates) {
    const holders = new Set();
    for (const t of templates || []) for (const m of String(t.text).matchAll(/<[^<>\n]+>/g)) holders.add(m[0]);
    for (const h of holders) { const i = text.indexOf(h); if (i >= 0) return { text: h, index: i }; }
    return null;
  }

  /** Claude Code's list options (--tools A,B) swallow whatever follows them, so a task at the end never arrives and the terminal just opens.
   *  The task goes straight after `claude`, where nothing can take it. */
  function taskFirst(cmd) {
    const m = /^(claude)(\s|$)/.exec(cmd);
    if (!m || !cmd.includes('{task}')) return cmd;
    const rest = cmd.slice(m[1].length).split('{task}').join('').replace(/\s+$/, '').replace(/^\s+/, '');
    return `claude {task}${rest ? ' ' + rest : ''}`;
  }

  const runIsLive = (run) => [...state.terms.values()].some((t) => t.runId === run.id && !t.exited);

  async function refreshRuns() {
    if (!state.project || !state.project.isRepo) { state.runs = null; renderAgentsPane(); return; }
    const res = await api.runs.list();
    state.runs = res.error ? { error: res.error, runs: [] } : res;
    renderAgentsPane();
  }

  state.prStatus = state.prStatus || {};
  async function loadPrStatus(run) {
    state.prStatus[run.id] = { text: 'Checking…', workItems: [] };
    renderAgentsPane();
    const res = await api.runs.status(run.id);
    state.prStatus[run.id] = res.error ? { text: res.error, workItems: [], error: true } : res.status;
    renderAgentsPane();
  }

  function prStatusRow(run) {
    const st = state.prStatus[run.id];
    if (!st) return null;
    const chips = (st.workItems || []).map((w) => (w.url
      ? el('a', { class: 'chip', href: '#', title: `Open ${w.kind} ${w.key}`, text: w.key, onclick: (e) => { e.preventDefault(); api.openExternal(w.url); } })
      : el('span', { class: 'chip', title: `${w.kind} mentioned in the branch, task or commits`, text: w.key })));
    const pr = st.pr && st.pr.found ? st.pr : null;
    const cls = !pr ? 'muted' : pr.state === 'merged' ? 'st-A' : st.pr.checks && st.pr.checks.failed || pr.mergeable === 'conflicts' || pr.review === 'changes' ? 'danger' : '';
    return el('div', { class: 'run-pr' },
      pr && pr.url ? el('a', { href: '#', class: cls, title: pr.title, text: st.text, onclick: (e) => { e.preventDefault(); api.openExternal(pr.url); } }) : el('span', { class: cls || 'muted', text: st.text }),
      ...chips);
  }

  function promptChip(run) {
    const t = [...state.terms.values()].find((x) => x.runId === run.id && x.prompt);
    return t ? el('span', { class: 'chip warnchip', title: t.prompt.text, text: 'needs approval' }) : null;
  }

  function fixChip(run) {
    const t = [...state.terms.values()].find((x) => x.runId === run.id && x.fix);
    if (!t) return null;
    const f = t.fix;
    const text = f.state === 'fixing' ? `fix ${f.round}/${f.maxRounds}` : f.state === 'checking' ? 'checking' : f.state === 'done' ? 'green' : 'needs you';
    return el('span', { class: `chip ${f.state === 'done' ? 'live' : f.state === 'stop' || f.state === 'error' ? 'warnchip' : 'on'}`, title: f.reason || '', text });
  }

  // ---------- Fleet: all agents at a glance (context fullness, state, tokens, estimated cost) ----------
  const fleetUi = { filter: 'all', sort: 'status', text: '', open: new Set(), view: null, busy: false };
  function fleetEvent(t, kind, text) {
    t.events = t.events || [];
    t.events.push({ at: Date.now(), kind, text });
    if (t.events.length > 80) t.events.splice(0, t.events.length - 80);
  }
  const fleetFor = (t) => (t.fleet = t.fleet || { totalInput: 0, totalOutput: 0, requests: 0, errors: 0 });
  api.onFleetUsage((u) => {
    const t = [...state.terms.values()].find((x) => !x.exited && x.local && x.local.proxy && x.local.proxy.token && x.local.proxy.token === u.token);
    if (!t) return;
    const f = fleetFor(t);
    f.requests++; f.totalInput += u.input || 0; f.totalOutput += u.output || 0; f.model = u.model || f.model; f.lastRequestAt = u.at || Date.now();
    if (u.input > 0) f.lastInput = u.input;
    if (u.error) {
      f.errors++; f.lastError = u.error;
      if (/context|too long|exceed|truncat|num_ctx/i.test(u.error)) { f.overflow = true; fleetEvent(t, 'error', `context is full: ${u.error.slice(0, 100)}`); dbg('model', `terminal ${t.id}: the conversation no longer fits the context window (${u.error.slice(0, 120)})`); }
      else fleetEvent(t, 'error', u.error.slice(0, 100));
    } else {
      if (u.input > 0) f.overflow = false;
      fleetEvent(t, 'model', `model request: ${u.input || 0} in / ${u.output || 0} out${u.ms ? `, ${Math.round(u.ms / 100) / 10}s` : ''}`);
    }
    scheduleFleet();
  });
  api.onFleetSubagent((id, sub) => {
    const t = [...state.terms.values()].find((x) => x.id === id);
    if (!t) return;
    const list = (t.subagents = t.subagents || []);
    const type = sub.type || 'subagent';
    if (sub.kind === 'substart') {
      list.push({ id: sub.agentId, type, startedAt: Date.now() });
      fleetEvent(t, 'sub', `subagent started: ${type}`);
    } else {
      const open = list.slice().reverse().find((a) => !a.endedAt && ((sub.agentId && a.id === sub.agentId) || (!sub.agentId && a.type === type)));
      if (open) { open.endedAt = Date.now(); open.text = sub.text; } else list.push({ id: sub.agentId, type, startedAt: Date.now(), endedAt: Date.now(), text: sub.text });
      fleetEvent(t, 'sub', `subagent finished: ${type}${sub.text ? `: ${sub.text.slice(0, 100)}` : ''}`);
    }
    if (list.length > 40) list.splice(0, list.length - 40);
    scheduleFleet();
  });
  api.otel.on((id, snap, activity) => {
    const t = [...state.terms.values()].find((x) => x.id === id);
    if (!t) return;
    fleetFor(t).otel = snap;
    for (const a of activity || []) fleetEvent(t, a.kind, a.text);
    if (snap.lastError && /context|too long|exceed|truncat/i.test(snap.lastError)) fleetFor(t).overflow = true;
    scheduleFleet();
  });
  api.onFleetTranscript((id, u) => {
    const t = [...state.terms.values()].find((x) => x.id === id);
    if (!t || (t.local && t.local.proxy)) return;
    fleetFor(t).cloud = u;
    fleetEvent(t, 'turn', `turn done: ${u.messages} replies so far`);
    scheduleFleet();
  });
  let fleetTimer = null;
  function scheduleFleet() { if (!fleetTimer) fleetTimer = setTimeout(() => { fleetTimer = null; renderFleet(); }, 300); }
  const fleetSnapshot = () => {
    const runsById = new Map(((state.runs && state.runs.runs) || []).map((r) => [r.id, r]));
    return [...state.terms.values()].filter((t) => t.agent).map((t) => ({
      key: String(t.key), runId: t.runId || null, subagents: t.subagents || [], label: t.title, startedAt: t.startedAt, lastData: t.lastData || 0, exited: !!t.exited, exitedAt: t.exitedAt || 0, prompt: !!t.prompt, idleAt: t.idleAt || 0,
      context: (t.local && t.local.context) || 0, model: (t.local && t.local.model) || '', fleet: t.fleet || null, events: t.events || [],
      autoMergeArmed: !!(t.runId && runsById.has(t.runId) && runsById.get(t.runId).autoMergeArmed),
    }));
  };
  async function renderFleet() {
    const host = $('#a-fleet');
    if (!host || fleetUi.busy) return;
    const snap = fleetSnapshot();
    if (!snap.length) { host.replaceChildren(); fleetUi.view = null; if (boardUi.open) renderBoard(); return; }
    fleetUi.busy = true;
    let v; try { v = await api.fleetView(snap, { filter: fleetUi.filter, sort: fleetUi.sort, text: fleetUi.text }); } finally { fleetUi.busy = false; }
    if (!v || v.error) return;
    fleetUi.view = v;
    checkBestOf(); if (boardUi.open) renderBoard();
    const sm = v.summary;
    const stat = (n, label, cls, filter, icon) => el('button', { class: `fl-stat ${cls}${fleetUi.filter === filter ? ' on' : ''}`, title: `Show only: ${label}`, onclick: () => { fleetUi.filter = fleetUi.filter === filter ? 'all' : filter; renderFleet(); } }, ic(icon), el('b', { text: String(n) }), ` ${label}`);
    const money = (c) => (c === null ? '' : ` · ~$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}`);
    const head = el('div', { class: 'fl-head' },
      el('div', { class: 'fl-stats' }, stat(sm.running, 'running', 'ok', 'running', 'play'), stat(sm.waiting, 'waiting', 'warn', 'waiting', 'timer'), stat(sm.stale, 'stale', 'warn', 'stale', 'history'), stat(sm.blowouts, 'context full', 'err', 'blowouts', 'database')),
      el('div', { class: 'fl-tot muted', title: 'Model tokens used by the agents in this window. The cost is an estimate from the prices in .ide/config.json (fleet.prices); local models cost nothing.', text: `${sm.tokensText}${money(sm.cost)}` }),
      el('div', { class: 'fl-tools' },
        el('input', { class: 'fl-q', type: 'search', placeholder: 'Filter…', value: fleetUi.text, 'aria-label': 'Filter agents', oninput: (e) => { fleetUi.text = e.target.value; scheduleFleet(); } }),
        (() => { const sel = el('select', { 'aria-label': 'Sort agents', onchange: (e) => { fleetUi.sort = e.target.value; renderFleet(); } }, ...[['status', 'Sort: needs attention'], ['context', 'Sort: context'], ['tokens', 'Sort: tokens'], ['time', 'Sort: time']].map(([val, label]) => el('option', { value: val, text: label }))); sel.value = fleetUi.sort; return sel; })()));
    const cards = v.rows.map((r) => {
      const open = fleetUi.open.has(r.key);
      const pctText = r.pct === null ? (r.cloudContext ? `${fmtK(r.cloudContext)} tokens in context` : 'context unknown') : `${Math.round(r.pct * 100)}% of ${fmtK(r.context)} context`;
      return el('div', { class: `fl-card st-${r.state}${r.blowout ? ' blow' : ''}` },
        el('div', { class: 'fl-row', onclick: () => { if (open) fleetUi.open.delete(r.key); else fleetUi.open.add(r.key); renderFleet(); }, title: 'Show what this agent did' },
          el('span', { class: `fl-dot st-${r.state}`, title: r.state }),
          el('span', { class: 'name', text: r.label }),
          el('span', { class: 'chip', text: r.state === 'idle' ? 'waiting for you' : r.state === 'waiting' ? 'needs approval' : r.state }),
          r.model ? el('span', { class: 'chip', text: r.model }) : null,
          r.subagents.length ? el('span', { class: 'chip', title: 'Helper agents this agent started', text: `${r.subagents.filter((a) => !a.endedAt).length}/${r.subagents.length} subagents` }) : null,
          r.autoMergeArmed && r.state !== 'exited' ? el('span', { class: 'chip armed', title: 'Auto-merge is on for this kind of task - it merges itself once the gates are clean and the scorecard backs it.' }, ic('git-merge'), ' auto-merge armed') : null,
          el('span', { class: 'fl-time muted', text: r.state === 'exited' ? `ran ${r.elapsedText}` : `${r.elapsedText}${r.state === 'stale' ? ` · quiet ${r.quietText}` : ''}` })),
        el('div', { class: `fl-bar lv-${r.level}`, title: pctText }, el('div', { class: 'fl-fill', style: `width:${Math.min(100, Math.round((r.pct || 0) * 100))}%` })),
        el('div', { class: 'fl-sub muted' }, `${pctText} · ${r.tokensText} · ${r.requests} request${r.requests === 1 ? '' : 's'}`, r.cost !== null ? ` · ~$${r.cost.toFixed(2)}` : ''),
        open && r.cloud ? el('div', { class: 'fl-sub muted', title: 'What the session total above is made of: tokens read fresh from your messages and files, tokens served from the prompt cache, tokens written to the cache, and what the model produced' }, `${fmtK(r.cloud.input)} new in · ${fmtK(r.cloud.cacheRead)} cache read · ${fmtK(r.cloud.cacheCreate)} cache write · ${fmtK(r.cloud.output)} out`) : null,
        r.blowout && r.state !== 'exited' ? el('div', { class: 'fl-warn', text: 'The conversation has outgrown the model’s context. The agent starts forgetting earlier instructions. Start a fresh run, or raise the context window (Agent settings).' }) : null,
        r.state === 'stale' ? el('div', { class: 'fl-warn', text: `No output and no model request for ${r.quietText}. The agent may be stuck.` }) : null,
        open && r.subagents.length ? el('div', { class: 'fl-subs' }, ...r.subagents.slice().reverse().map((a) => el('div', { class: 'fl-sub-row' }, el('span', { class: `fl-dot ${a.endedAt ? 'st-exited' : 'st-running'}` }), el('b', { text: ` ${a.type}` }), el('span', { class: 'muted', text: ` ${a.endedAt ? `done in ${fmtMs(a.endedAt - a.startedAt)}` : 'working'}${a.text ? `: ${a.text.slice(0, 160)}` : ''}` })))) : null,
        open ? el('div', { class: 'fl-events' }, ...(r.events.length ? r.events.slice().reverse().map((e) => el('div', { class: `fl-ev k-${e.kind}` }, el('span', { class: 'muted', text: new Date(e.at).toLocaleTimeString() }), ` ${e.text}`)) : [el('div', { class: 'muted', text: 'Nothing recorded yet.' })])) : null);
    });
    if (!cards.length) cards.push(el('div', { class: 'empty', text: 'No agent matches this filter.' }));
    host.replaceChildren(head, ...cards);
  }
  const fmtMs = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
  const fmtK = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  setInterval(() => { if (!document.hidden) renderFleet(); }, 5000);

  // ---------------------------------------------------------------- best of N: one task, several agents, a ranking
  const bestOf = { groups: [] };
  function openBestOf(preset = {}) {
    const agents = ((state.project && state.project.config && state.project.config.agents) || []);
    if (!agents.length) { setStatus('No agents configured. Add one in Settings.'); return; }
    const close = () => $('#modal').classList.add('hidden');
    const task = el('textarea', { rows: '5', placeholder: 'The task every agent gets', spellcheck: 'false', id: 'bo-task' }); task.value = preset.task || '';
    const name = el('input', { type: 'text', placeholder: 'Name (optional)', spellcheck: 'false', id: 'bo-name' }); name.value = preset.name || '';
    const allow = el('input', { type: 'text', placeholder: 'Allowed paths (optional)', spellcheck: 'false' });
    const last = agents.findIndex((a) => a.name === lastAgentName());
    const counts = agents.map((a, i) => { const n = el('input', { type: 'number', min: '0', max: '3', value: i === Math.max(0, last) || (i === 0 && last < 0) ? '1' : '0', class: 'bo-n', 'aria-label': `Copies of ${agentLabel(a)}` }); n.dataset.i = String(i); return n; });
    const total = el('div', { class: 'hint' });
    const sync = () => { const n = counts.reduce((t, c) => t + Math.max(0, Number(c.value) || 0), 0); total.textContent = `${n} run${n === 1 ? '' : 's'}${n > BazingaBestOf.MAX_RUNS ? ` (the first ${BazingaBestOf.MAX_RUNS} are started)` : ''}`; return n; };
    for (const c of counts) c.addEventListener('input', sync);
    sync();
    const localCount = () => counts.reduce((t, c) => t + (isLocalAgent(agents[Number(c.dataset.i)]) ? Math.max(0, Number(c.value) || 0) : 0), 0);
    const start = async () => {
      const text = task.value.trim();
      if (!text) { task.focus(); return; }
      const picked = BazingaBestOf.plan(counts.map((c) => ({ agent: agents[Number(c.dataset.i)], copies: c.value })), agentLabel);
      if (picked.length < 2) { setStatus('Pick at least two runs: two agents, or one agent twice.'); return; }
      if (localCount() > 1 && !window.confirm('Several runs use a local model. They share your graphics card and memory, so they run slower, and different models take turns being loaded.\n\nStart them all anyway?')) return;
      const base = name.value.trim() || text.split(/\s+/).slice(0, 4).join(' ');
      close();
      const runIds = [];
      for (const p of picked) {
        const res = await startRun({ task: text, name: `${base} ${p.label}`, agent: p.agent, allow: allow.value.trim(), activate: false, noEscalate: true });
        if (res && res.run) runIds.push(res.run.id);
      }
      if (runIds.length) {
        bestOf.groups.push({ id: String(Date.now()), name: base, runIds, announced: false });
        setSideTab('agents'); renderBestOfCards();
        setStatus(`${runIds.length} runs started for “${base}”. When they are all done, “Rank results” shows which one to keep.`);
      }
    };
    $('#dialog').replaceChildren(el('h3', { text: 'Best of several agents' }),
      el('div', { class: 'field' }, el('label', { text: 'Task' }), task),
      el('div', { class: 'field' }, el('label', { text: 'How many runs of each agent' }),
        ...agents.map((a, i) => el('div', { class: 'bo-row' }, counts[i], el('span', { text: ` ${agentLabel(a)}` }), isLocalAgent(a) ? el('span', { class: 'chip', text: 'local' }) : null)), total),
      el('div', { class: 'field' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { text: 'Scope' }), allow),
      el('div', { class: 'hint', text: 'Every run gets its own git worktree and branch. Afterwards the results are ranked (gates first, then the smallest change); you read the diff and keep one. Local models share one GPU: two or three runs is plenty.' }),
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), el('button', { class: 'primary', id: 'bo-start', onclick: start }, ic('play'), 'Start all')));
    $('#modal').classList.remove('hidden');
    task.focus();
  }

  function renderBestOfCards() {
    const host = $('#a-bestof');
    if (!host) return;
    const live = new Set(((state.runs && state.runs.runs) || []).map((r) => r.id));
    bestOf.groups = bestOf.groups.filter((g) => g.runIds.some((id) => live.has(id))); // all discarded or merged: the group is gone
    host.replaceChildren(...bestOf.groups.map((g) => {
      const ids = g.runIds.filter((id) => live.has(id));
      return el('div', { class: `bo-card${g.announced ? ' done' : ''}` },
        el('div', { class: 'run-title' }, ic('git-compare'), el('span', { class: 'name', text: g.name }), el('span', { class: 'chip', text: g.announced ? 'all finished' : `${ids.length} running` })),
        el('div', { class: 'run-acts' },
          el('button', { class: 'primary bo-rank', title: 'Run the gates on each result and rank them', onclick: () => openBestOfRank(g) }, ic('list-ordered'), 'Rank results…'),
          el('button', { class: 'icon', title: 'Dismiss this group (the runs stay)', 'aria-label': 'Dismiss', onclick: () => { bestOf.groups = bestOf.groups.filter((x) => x !== g); renderBestOfCards(); } }, ic('x'))));
    }));
  }

  /** Called with every fleet refresh: tell the user once when the whole group has stopped working. */
  function checkBestOf() {
    if (!bestOf.groups.length || !fleetUi.view) return;
    const states = {};
    for (const run of (state.runs && state.runs.runs) || []) { const st = BazingaBoard.stateOfRun(run, fleetUi.view.rows); if (st) states[run.id] = st; }
    let changed = false;
    for (const g of bestOf.groups) {
      if (g.announced) continue;
      if (BazingaBestOf.finished(g.runIds, states) && g.runIds.every((id) => states[id])) {
        g.announced = true; changed = true;
        setStatus(`Best of “${g.name}”: all ${g.runIds.length} runs have stopped. Open Agents → Rank results.`);
        dbg('workflow', `best of “${g.name}” finished`);
      }
    }
    if (changed) renderBestOfCards();
  }

  async function openBestOfRank(group) {
    const close = () => $('#modal').classList.add('hidden');
    const runs = (state.runs && state.runs.runs) || [];
    const ids = group.runIds.filter((id) => runs.some((r) => r.id === id));
    if (ids.length < 2) { setStatus('Fewer than two runs of this group are left.'); return; }
    const gates = el('input', { type: 'checkbox', id: 'bo-gates' }); gates.checked = true;
    const out = el('div', { class: 'cmp' });
    const go = async () => {
      fill(out, el('div', { class: 'muted', text: gates.checked ? 'Running the gates on every result…' : 'Reading the results…' }));
      const res = await api.runs.summaries({ ids, gates: gates.checked });
      if (res.error) { fill(out, el('div', { class: 'hint danger', text: res.error })); return; }
      const ranked = BazingaBestOf.rank(res.sums);
      fill(out,
        ...ranked.rows.map((r) => {
          const run = runs.find((x) => x.id === r.id);
          return el('div', { class: `bo-res${r.best ? ' best' : ''}` },
            el('div', { class: 'run-title' }, el('b', { text: `${r.place}. ${r.name}` }), r.best ? el('span', { class: 'chip live', text: 'suggested' }) : null, el('span', { class: 'muted', text: r.agent })),
            el('div', { class: r.errors ? 'danger' : 'muted', text: r.text }),
            el('div', { class: 'run-acts' },
              el('button', { onclick: () => { close(); if (run) reviewRun(run); } }, ic('eye'), 'Review'),
              el('button', { class: 'bo-keep', title: 'Merge this one and discard the other runs of the group', onclick: () => keepOne(run, ids) }, ic('git-merge'), 'Keep this one…')));
        }),
        el('div', { class: 'hint', text: ranked.note }));
    };
    const keepOne = async (winner, all) => {
      if (!winner) return;
      const others = runs.filter((r) => all.includes(r.id) && r.id !== winner.id);
      if (!window.confirm(`Keep “${winner.name}” and discard ${others.length} other run${others.length === 1 ? '' : 's'}?\n\n${others.map((r) => r.branch).join('\n')}\n\nTheir worktrees and branches are deleted. Next you choose how “${winner.name}” is merged.`)) return;
      close();
      if (state.runs && others.some((r) => r.root === state.runs.current) && !(await switchRoot(state.runs.main.root))) return;
      for (const r of others) {
        for (const t of state.terms.values()) if (t.runId === r.id && t.id !== null && !t.exited) api.pty.kill(t.id);
        const res = await api.runs.discard(r.id, 'lost'); // the group's other runs lost to the one you kept
        if (res.error) { window.alert(res.error); break; }
      }
      bestOf.groups = bestOf.groups.filter((g) => g !== group);
      await refreshRuns();
      const fresh = ((state.runs && state.runs.runs) || []).find((r) => r.id === winner.id);
      if (fresh) mergeRunDialog(fresh);
    };
    $('#dialog').replaceChildren(el('h3', { text: `Results: ${group.name}` }),
      el('label', { class: 'check' }, gates, ' Run the gates on every result (slower, much better ranking)'),
      out,
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Close'), el('button', { class: 'primary', id: 'bo-rerank', onclick: go }, ic('list-ordered'), 'Rank')));
    $('#modal').classList.remove('hidden');
    go();
  }

  // ---------------------------------------------------------------- board: backlog -> running -> needs you -> ready to review
  const boardUi = { open: false, items: [], provider: 'azure', scope: 'mine', loading: false, error: '', providers: null, loaded: false };
  async function openBoard() {
    boardUi.open = true;
    $('#board').classList.remove('hidden');
    renderBoard();
    renderFleet();
    if (!boardUi.providers) {
      const prov = await api.workitems.providers();
      boardUi.providers = prov && !prov.error ? prov : { azure: true, jira: false };
      boardUi.provider = boardUi.providers.azure || !boardUi.providers.jira ? 'azure' : 'jira';
      renderBoard();
    }
  }
  function closeBoard() { boardUi.open = false; $('#board').classList.add('hidden'); }
  async function loadBacklog() {
    boardUi.loading = true; boardUi.error = ''; renderBoard();
    const r = await api.workitems.list({ scope: boardUi.scope, provider: boardUi.provider });
    boardUi.loading = false; boardUi.loaded = true;
    if (r.error) { boardUi.error = r.error; boardUi.items = []; } else boardUi.items = r.items;
    renderBoard();
  }
  async function startFromItem(w) {
    const r = await api.workitems.show(w.id, boardUi.provider);
    if (r.error) { boardUi.error = r.error; renderBoard(); return; }
    const item = r.item || w;
    openRunDialog({ task: r.text, name: `${item.ref || `AB#${item.id}`} ${item.title}`.slice(0, 60) });
  }
  function renderBoard() {
    const host = $('#board');
    if (!host || !boardUi.open) return;
    const runs = (state.runs && state.runs.runs) || [];
    const rows = (fleetUi.view && fleetUi.view.rows) || [];
    const cols = BazingaBoard.build(runs, rows);
    const backlog = BazingaBoard.backlog(boardUi.items, runs);
    const card = (c) => {
      const run = c.run; const row = c.row;
      return el('div', { class: `bd-card st-${c.state || 'exited'}`, title: run.task || run.name },
        el('div', { class: 'run-title' }, el('span', { class: 'name', text: run.name }), c.state === 'stale' ? el('span', { class: 'chip warnchip', text: 'stale' }) : c.state === 'waiting' ? el('span', { class: 'chip warnchip', text: 'approval' }) : null),
        el('div', { class: 'muted small', text: `${run.agent || 'agent'} · ${run.files} file${run.files === 1 ? '' : 's'}${row && row.pct !== null ? ` · ${Math.round(row.pct * 100)}% context` : ''}${row && row.cost != null ? ` · ~$${row.cost.toFixed(2)}` : ''}` }),
        row && row.pct !== null ? el('div', { class: `fl-bar lv-${row.level}` }, el('div', { class: 'fl-fill', style: `width:${Math.min(100, Math.round(row.pct * 100))}%` })) : null,
        el('div', { class: 'run-acts' },
          el('button', { class: 'primary', onclick: () => { closeBoard(); reviewRun(run); } }, ic('eye'), 'Review'),
          el('button', { class: 'icon', title: 'Merge…', 'aria-label': 'Merge', onclick: () => { closeBoard(); mergeRunDialog(run); } }, ic('git-merge')),
          el('button', { class: 'icon', title: 'Open its terminal', 'aria-label': 'Terminal', onclick: () => { closeBoard(); openRunTerminal(run); } }, ic('terminal'))));
    };
    const column = (key, children, extra) => el('div', { class: `bd-col bd-${key}`, 'data-col': key,
      ondragover: key === 'running' ? (e) => { e.preventDefault(); } : null,
      ondrop: key === 'running' ? (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const w = boardUi.items.find((x) => String(x.id) === id); if (w) startFromItem(w); } : null },
      el('div', { class: 'bd-head' }, el('b', { text: BazingaBoard.TITLES[key] }), el('span', { class: 'badge', text: String(children.length) }), extra || null),
      el('div', { class: 'bd-body' }, ...(children.length ? children : [el('div', { class: 'muted small', text: key === 'backlog' ? (boardUi.loaded ? 'Nothing open that has no run yet.' : 'Load your work items to start runs from them.') : key === 'running' ? 'Drop a backlog item here to start a run.' : 'Empty' })])));
    const provSel = el('select', { id: 'bd-provider', 'aria-label': 'Work item source', onchange: (e) => { boardUi.provider = e.target.value; boardUi.loaded = false; boardUi.items = []; loadBacklog(); } }, el('option', { value: 'azure', text: 'Azure Boards' }), el('option', { value: 'jira', text: 'Jira' }));
    provSel.value = boardUi.provider;
    const backCards = backlog.map((w) => el('div', { class: 'bd-card bd-item', draggable: 'true', title: 'Drag to Running to start a run',
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(w.id)); e.dataTransfer.effectAllowed = 'copy'; } },
      el('div', { class: 'run-title' }, el('span', { class: 'chip', text: w.type || 'item' }), el('b', { text: ` ${w.ref || w.id}` })),
      el('div', { text: w.title }),
      el('div', { class: 'run-acts' }, el('button', { class: 'primary', onclick: () => startFromItem(w) }, ic('play'), 'Start run…'))));
    host.replaceChildren(
      el('div', { class: 'bd-top' }, el('h3', { text: 'Board' }), el('div', { class: 'bd-tools' }, provSel,
        el('button', { id: 'bd-load', onclick: loadBacklog }, ic('refresh-cw'), boardUi.loading ? 'Loading…' : boardUi.loaded ? 'Reload backlog' : 'Load backlog'),
        el('button', { class: 'icon', title: 'Close the board', 'aria-label': 'Close', onclick: closeBoard }, ic('x')))),
      boardUi.error ? el('div', { class: 'hint danger', text: boardUi.error }) : null,
      el('div', { class: 'bd-cols' },
        column('backlog', backCards),
        column('running', cols.running.map(card)),
        column('needs', cols.needs.map(card)),
        column('review', cols.review.map(card))));
  }

  // ---------------------------------------------------------------- updates (checks by default; download/install always need a click; the source, if not the embedded one, is set in the settings: updates.github or updates.url)
  const updateUi = { status: 'idle', text: '', render: null };
  api.updates.on((ev, info, text) => {
    updateUi.status = ev; updateUi.text = text || '';
    if (updateUi.render) updateUi.render();
    if (ev === 'available' || ev === 'downloaded') setStatus(text);
  });
  async function openUpdates() {
    const close = () => { updateUi.render = null; $('#modal').classList.add('hidden'); };
    const msg = el('div', { id: 'upd-msg', class: 'hint' });
    const act = el('div', { class: 'actions' });
    const draw = () => {
      msg.textContent = updateUi.text || 'Press “Check now”. Nothing is downloaded or installed without your OK.';
      const buttons = [el('button', { onclick: close }, ic('x'), 'Close')];
      if (updateUi.status === 'available') buttons.push(el('button', { class: 'primary', id: 'upd-download', onclick: async () => { const r = await api.updates.download(); if (r.error) { msg.textContent = r.error; msg.classList.add('danger'); } } }, ic('download'), 'Download'));
      else if (updateUi.status === 'downloaded') buttons.push(el('button', { class: 'primary', id: 'upd-install', onclick: () => api.updates.install() }, ic('refresh-cw'), 'Restart and install'));
      else buttons.push(el('button', { class: 'primary', id: 'upd-check', disabled: updateUi.status === 'checking' || updateUi.status === 'progress', onclick: check }, ic('refresh-cw'), 'Check now'));
      act.replaceChildren(...buttons);
    };
    const check = async () => {
      msg.classList.remove('danger'); updateUi.status = 'checking'; updateUi.text = 'Checking for updates…'; draw();
      const r = await api.updates.check();
      if (r.error) { updateUi.status = 'idle'; updateUi.text = r.error; draw(); msg.classList.add('danger'); }
    };
    updateUi.render = draw;
    $('#dialog').replaceChildren(el('h3', { text: 'Updates' }), msg,
      el('div', { class: 'hint', text: 'Checks at every start by default. A packaged release build already knows where to look; to point it somewhere else (running from source, a fork), set "updates": { "github": "owner/repo" } or { "url": "https://…" } in the IDE settings. Works with the installer version; the portable Windows build and unsigned macOS builds cannot install updates by themselves.' }), act);
    draw();
    $('#modal').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- Bazinga's MCP server: what an agent may ask (see core/mcpserver.js)
  const mcpRunInfo = (run) => {
    const st = (fleetUi.view && BazingaBoard.stateOfRun(run, fleetUi.view.rows)) || null;
    return { id: run.id, name: run.name, agent: run.agent || '', branch: run.branch, files: run.files, commits: run.commits || 0, state: st === 'running' ? 'working' : st === 'waiting' ? 'waiting for approval' : st === 'idle' ? 'waiting for the user' : st === 'stale' ? 'possibly stuck' : 'finished', task: (run.task || '').slice(0, 300) };
  };
  api.mcp.onCall(async (reqId, method, args) => {
    let result;
    try {
      const runs = (state.runs && state.runs.runs) || [];
      if (method === 'listRuns') result = runs.map(mcpRunInfo);
      else if (method === 'runStatus') {
        const run = runs.find((r) => r.id === String(args.id));
        if (!run) result = { error: `No run with id ${args.id}. Use list_runs.` };
        else {
          const row = fleetUi.view && fleetUi.view.rows.find((r) => r.runId === run.id);
          result = { ...mcpRunInfo(run), contextUsedPercent: row && row.pct !== null ? Math.round(row.pct * 100) : null, tokens: row ? row.tokensText : null, subagents: row ? row.subagents.length : 0, lastError: row ? row.lastError : '', stats: run.statsText || '' };
        }
      } else if (method === 'startRun') {
        const callerTerm = [...state.terms.values()].find((t) => t.id === args.caller);
        const agents = (state.project && state.project.config && state.project.config.agents) || [];
        const agent = agents.find((a) => a.name === args.agent) || (callerTerm && callerTerm.agent && agents.find((a) => a.name === callerTerm.agent)) || agents[0];
        if (!agent) result = { error: 'No agent is configured in Bazinga.' };
        else if (!window.confirm(`${callerTerm ? `The agent “${callerTerm.title}”` : 'An agent'} asks Bazinga to start a new agent run (${agentLabel(agent)}):\n\n${String(args.task).slice(0, 600)}\n\nStart it?`)) result = { error: 'The user declined.' };
        else {
          const name = String(args.name || '').trim() || String(args.task).split(/\s+/).slice(0, 5).join(' ');
          const started = await startRun({ task: String(args.task), name, agent, allow: '', activate: false });
          result = started ? { id: started.run.id, name: started.run.name, branch: started.run.branch, note: 'Started. Use run_status to follow it.' } : { error: 'The run could not be started.' };
        }
      } else result = { error: `Unknown request ${method}` };
    } catch (err) { result = { error: String((err && err.message) || err) }; }
    api.mcp.reply(reqId, result);
  });

  // ---------------------------------------------------------------- ACP agents (Agent Client Protocol): a transcript instead of a terminal
  let acpSeq = 0;
  function newAcpEntry({ title, cwd, runId, agentName }) {
    const key = `t${++state.termSeq}`;
    const id = `acp-${++acpSeq}`;
    const container = el('div', { class: 'term acp' });
    $('#terms').append(container);
    const log = el('div', { class: 'acp-log', tabindex: '0' });
    const input = el('textarea', { class: 'acp-input', rows: '2', placeholder: 'Message to the agent (Ctrl+Enter sends)…', spellcheck: 'false', 'aria-label': 'Message to the agent' });
    const sendBtn = el('button', { class: 'primary acp-send' }, ic('send'), 'Send');
    const stopBtn = el('button', { class: 'acp-stop', title: 'Ask the agent to stop what it is doing' }, ic('square'), 'Stop turn');
    container.append(log, el('div', { class: 'acp-bar' }, input, el('div', { class: 'acp-btns' }, sendBtn, stopBtn)));
    const noop = () => {};
    const term = new Proxy({ options: {}, cols: 80, rows: 24, buffer: { active: { length: 0, getLine: () => null } }, hasSelection: () => false, getSelection: () => '', focus: () => { try { input.focus(); } catch { /* hidden */ } } }, { get: (t, k) => (k in t ? t[k] : noop) });
    const entry = { acp: true, startedAt: Date.now(), key, title, term, fit: { fit: noop }, search: null, container, id, exited: false, runId: runId || null, agent: agentName, persist: false, sandboxed: false, cwd, lastData: Date.now(), log, input, blocks: new Map(), current: null, typePaths: null };
    const send = async () => {
      const text = input.value.trim();
      if (!text || entry.exited) return;
      input.value = '';
      acpAppend(entry, 'user', text);
      entry.idleAt = 0; entry.lastData = Date.now();
      await api.acp.send(id, text);
      renderAgentsPane();
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
    stopBtn.addEventListener('click', () => api.acp.cancel(id));
    state.terms.set(key, entry);
    showBottom(key);
    return entry;
  }

  /** Adds a line to the transcript; consecutive text chunks of the agent grow one block. */
  function acpAppend(entry, kind, text, extra = {}) {
    let block = null;
    if ((kind === 'text' || kind === 'thought') && entry.current && entry.current.kind === kind) block = entry.current.node;
    if (!block) {
      block = el('div', { class: `acp-msg acp-${kind}` });
      if (kind === 'user') block.prepend(el('div', { class: 'muted small', text: 'You' }));
      entry.log.append(block);
      entry.current = (kind === 'text' || kind === 'thought') ? { kind, node: block } : null;
    }
    if (extra.node) block.append(extra.node); else block.append(document.createTextNode(text));
    const atEnd = entry.log.scrollHeight - entry.log.scrollTop - entry.log.clientHeight < 80;
    if (atEnd) entry.log.scrollTop = entry.log.scrollHeight;
    return block;
  }

  function acpEvent(id, e) {
    const entry = [...state.terms.values()].find((t) => t.id === id);
    if (!entry) return;
    entry.lastData = Date.now();
    const log = entry.log;
    switch (e.type) {
      case 'ready': entry.current = null; acpAppend(entry, 'info', `Connected${e.agent ? ` to ${e.agent}` : ''}.`); break;
      case 'text': acpAppend(entry, 'text', e.text); break;
      case 'thought': acpAppend(entry, 'thought', e.text); break;
      case 'tool': {
        entry.current = null;
        const row = el('div', { class: `acp-tool st-${e.status}` }, el('span', { class: 'chip', text: e.kind }), el('span', { class: 'acp-tool-title', text: ` ${e.title}` }), el('span', { class: 'acp-tool-status', text: ` ${e.status}` }), e.paths.length ? el('div', { class: 'muted small', text: e.paths.join(', ') }) : null);
        entry.blocks.set(e.id, row); log.append(row); log.scrollTop = log.scrollHeight;
        fleetEvent(entry, 'tool', `${e.kind}: ${e.title}`.slice(0, 120));
        break;
      }
      case 'tool_update': {
        const row = entry.blocks.get(e.id);
        if (row) { row.className = `acp-tool st-${e.status || 'pending'}`; const st = row.querySelector('.acp-tool-status'); if (st && e.status) st.textContent = ` ${e.status}`; }
        if (e.note) acpAppend(entry, 'info', e.note);
        break;
      }
      case 'plan': {
        entry.current = null;
        const list = el('ul', { class: 'acp-plan' }, ...e.entries.map((p) => el('li', { class: `st-${p.status}`, text: `${p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '→' : '·'} ${p.text}` })));
        if (entry.planNode) entry.planNode.replaceWith(list); else log.append(list);
        entry.planNode = list;
        break;
      }
      case 'permission': {
        entry.current = null;
        entry.prompt = { text: e.title, at: Date.now() };
        fleetEvent(entry, 'wait', `asks: ${e.title}`.slice(0, 120));
        const card = el('div', { class: 'acp-perm' },
          el('div', { class: 'run-title' }, ic('shield-check'), el('b', { text: ` ${e.title}` })),
          e.paths.length ? el('div', { class: 'muted small', text: e.paths.join(', ') }) : null);
        const row = el('div', { class: 'run-acts' });
        const answer = async (optionId, label) => {
          row.replaceChildren(el('span', { class: 'muted', text: label ? `You chose: ${label}` : 'Cancelled' }));
          entry.prompt = null; await api.acp.answer(id, e.id, optionId); renderBottomTabs(); renderAgentsPane();
        };
        for (const o of e.options) row.append(el('button', { class: o.kind.startsWith('allow') ? 'primary' : o.kind.startsWith('reject') ? 'danger' : '', onclick: () => answer(o.optionId, o.name) }, o.kind.startsWith('allow') ? ic('check') : o.kind.startsWith('reject') ? ic('x') : null, o.name));
        card.append(row); log.append(card); log.scrollTop = log.scrollHeight;
        renderBottomTabs(); renderAgentsPane();
        break;
      }
      case 'stop': entry.current = null; entry.prompt = null; acpAppend(entry, 'info', `— turn finished (${e.reason}) —`); break;
      case 'error': entry.current = null; acpAppend(entry, 'error', e.message); fleetEvent(entry, 'error', String(e.message).slice(0, 120)); break;
      case 'exit': entry.current = null; acpAppend(entry, 'info', `The agent process ended${e.code ? ` (code ${e.code})` : ''}.`); entry.input.disabled = true; break;
      default: break;
    }
    scheduleFleet();
  }
  api.acp.on(acpEvent);

  async function launchAcp(run, agent, task, cc, opts = {}) {
    if (cc.enabled) { window.alert('ACP agents do not run in a container yet. Turn the container setting off for this run, or use a terminal agent.'); await refreshRuns(); return false; }
    const entry = newAcpEntry({ title: `${run.name} · ${agent.name} (ACP)`, cwd: run.root, runId: run.id, agentName: agent.name });
    acpAppend(entry, 'info', `Starting ${agent.name}…`);
    // unattended: nobody can click "allow", so the agent's own policy applies and the default is to refuse
    const policy = opts.unattended ? (agent.policy === 'allow' ? 'allow' : 'reject') : (agent.policy || 'ask');
    dbg('agent', `launch ${agent.name} (ACP, policy ${policy}) in ${run.root}; task: ${String(task).slice(0, 120)}`);
    const res = await api.acp.start({ id: entry.id, agent: agent.name, cwd: run.root, task: withTaskPrefix(task), policy });
    if (res.error) { acpAppend(entry, 'error', res.error); entry.exited = true; renderBottomTabs(); await refreshRuns(); return entry; }
    acpAppend(entry, 'user', withTaskPrefix(task));
    renderBottomTabs(); await refreshRuns();
    return entry;
  }

  function renderAgentsPane() {
    const host = $('#a-list');
    if (!host) return;
    const r = state.runs;
    $('#agents-count').textContent = r && r.runs && r.runs.length ? `(${r.runs.length})` : '';
    if (!state.project || !state.project.isRepo) { host.replaceChildren(el('div', { class: 'empty', text: 'Agent runs need a git repository (with at least one commit).' })); return; }
    if (!r) { host.replaceChildren(); return; }
    if (r.error) { host.replaceChildren(el('div', { class: 'empty', text: r.error })); return; }
    const nodes = [];
    if (r.main) {
      nodes.push(el('div', { class: `run main${r.current === r.main.root ? ' current' : ''}`, onclick: () => switchRoot(r.main.root) },
        el('div', { class: 'run-title' }, ic('folder-open', 'ftype'), el('span', { class: 'name', text: 'Main checkout' }), el('span', { class: 'chip' }, ic('git-branch'), r.main.branch || '?'), r.current === r.main.root ? el('span', { class: 'chip on', text: 'viewing' }) : null)));
    }
    if (!r.runs.length) nodes.push(el('div', { class: 'empty', text: 'No agent runs yet. “New agent run…” gives an agent its own copy of the repository, so several can work in parallel and you review each result before it touches your branch.' }));
    for (const run of r.runs) {
      const live = runIsLive(run);
      const viewing = r.current === run.root;
      nodes.push(el('div', { class: `run${viewing ? ' current' : ''}`, title: run.task || run.name },
        el('div', { class: 'run-title' },
          ic('bot', 'ftype'),
          el('span', { class: 'name', text: run.name }),
          live ? el('span', { class: 'chip live', text: 'running' }) : el('span', { class: 'chip', text: 'idle' }),
          viewing ? el('span', { class: 'chip on', text: 'viewing' }) : null,
          promptChip(run), fixChip(run)),
        el('div', { class: 'run-sub muted', text: `${run.agent || 'agent'} · ${run.branch} · ${run.files} changed file${run.files === 1 ? '' : 's'}${run.commits ? ` · ${run.commits} commit${run.commits === 1 ? '' : 's'}` : ''}` }),
        run.statsText ? el('div', { class: 'run-stats muted', title: 'Time the agent was actually producing output (your reading time is not counted), and how often the fix loop sent it back to work', text: run.statsText }) : null,
        prStatusRow(run),
        run.task ? el('div', { class: 'run-task', text: run.task.length > 140 ? `${run.task.slice(0, 140)}…` : run.task }) : null,
        el('div', { class: 'run-acts' },
          el('button', { class: 'primary', title: 'Open this run’s changes (switches the IDE to its worktree)', onclick: () => reviewRun(run) }, ic('eye'), 'Review'),
          el('button', { title: 'Open a shell in this run’s worktree', onclick: () => openRunTerminal(run) }, ic('terminal'), 'Terminal'),
          el('button', { class: 'icon', title: 'Journal: what happened in this run', 'aria-label': 'Journal', onclick: () => openJournal(run) }, ic('history')),
          el('button', { class: 'icon', title: 'Replay: scrub through this run step by step', 'aria-label': 'Replay', onclick: () => openReplay(run) }, ic('play-circle')),
          el('button', { class: 'icon', title: 'Pull request status and linked work items (asks gh / az)', 'aria-label': 'PR status', onclick: () => loadPrStatus(run) }, ic('git-pull-request')),
          el('button', { title: 'Bring the result into your branch', onclick: () => mergeRunDialog(run) }, ic('git-merge'), 'Merge…'),
          el('button', { class: 'icon danger', title: 'Discard: delete the worktree and branch', 'aria-label': 'Discard', onclick: () => discardRun(run) }, ic('trash-2')))));
    }
    host.replaceChildren(...nodes);
    renderBestOfCards();
    if (boardUi.open) renderBoard();
    scheduleFleet();
  }

  function initAgentsPane() {
    $('#side-agents').replaceChildren(
      el('div', { class: 'c-head' }, el('div', { class: 'line wrap' },
        el('button', { class: 'primary', id: 'a-new', onclick: openRunDialog }, ic('plus'), 'New agent run…'),
        el('button', { id: 'a-workflow', title: 'Chain agent steps with gates and approvals', onclick: openWorkflows }, ic('workflow'), 'Workflow…'),
        el('button', { id: 'a-debug', title: 'Debug log: what the workflow and the agents are doing', onclick: () => showDebug() }, ic('bug'), 'Debug log'),
        el('button', { id: 'a-board', title: 'Board: backlog, running, needs you, ready to review', onclick: () => openBoard() }, ic('layout-dashboard'), 'Board'),
        el('button', { id: 'a-score', title: 'Scorecard: which agent does which kind of task well, from your own merges and discards', onclick: openScorecard }, ic('trophy'), 'Scorecard'),
        el('button', { id: 'a-compare', title: 'Compare two runs: files changed, size, gate result', onclick: openCompare }, ic('git-compare'), 'Compare…'),
        el('button', { id: 'a-skills', title: 'Agent skills: IDE level and project level', onclick: openSkills }, ic('package'), 'Skills'),
        el('button', { id: 'a-agentconfig', title: 'Agent configuration: MCP servers, skills, agents and hooks, across every runner found in this project', onclick: openAgentConfig }, ic('link'), 'Config'),
        el('button', { title: 'Refresh', onclick: refreshRuns }, ic('refresh-cw'), 'Refresh'))),
      el('div', { id: 'a-bestof', class: 'bestof-list' }),
      el('div', { id: 'a-fleet', class: 'fleet' }),
      el('div', { id: 'a-workflows', class: 'wf-list' }),
      el('div', { id: 'a-list' }));
  }

  async function switchRoot(target) {
    if (!state.project || state.project.root === target) return true;
    if ([...state.models.values()].some((m) => m.dirty) && !window.confirm('Some open files have unsaved changes that will be lost when you switch. Switch anyway?')) return false;
    await saveSessionNow();
    const res = await api.runs.switchTo(target);
    if (res.error) { setStatus(res.error); return false; }
    await resetWorkspace({ keepTerminals: true });
    state.task = { allow: '', summary: '', baseline: null, reviewed: {}, started: null };
    $('#t-allow').value = ''; $('#t-summary').value = '';
    await loadProject();
    const saved = await api.session.get();
    if (!api.smoke) await restoreSession(saved.project, { skipTerminals: true });
    return true;
  }

  async function reviewRun(run) {
    if (!(await switchRoot(run.root))) return;
    const res = await api.runs.prepareReview(run.id);
    if (res.error) setStatus(res.error);
    else if (res.folded) setStatus(`The agent made ${res.folded} commit${res.folded === 1 ? '' : 's'}; they are now staged changes so you can review everything in one place.`);
    await refreshChanges();
    await refreshRuns();
    setSideTab('changes');
  }

  async function openRunTerminal(run) {
    await newTerminal({ title: `${run.name} · shell`, cwd: run.root, runId: run.id, persist: true });
  }

  function openRunDialog(arg) {
    const preset = arg && typeof arg.task === 'string' ? arg : {};
    if (!state.project || !state.project.isRepo) { setStatus('Agent runs need a git repository.'); return; }
    const agents = ((state.project.config && state.project.config.agents) || []);
    if (!agents.length) { setStatus('No agents configured. Add one in Settings.'); return; }
    const task = el('textarea', { rows: '6', placeholder: 'What should the agent do? (this text is given to the agent as its first prompt)', spellcheck: 'false' });
    task.value = preset.task || '';
    const name = el('input', { type: 'text', placeholder: 'Run name (optional, defaults to the first words of the task)', spellcheck: 'false' }); name.value = preset.name || '';
    const agentSel = el('select', null, ...agents.map((a, i) => el('option', { value: String(i), text: agentLabel(a) })));
    const lastIdx = agents.findIndex((a) => a.name === lastAgentName()); if (lastIdx >= 0) agentSel.value = String(lastIdx); // the one you used last
    const allow = el('input', { type: 'text', placeholder: 'Allowed paths (optional), e.g. src/billing/**, docs/', spellcheck: 'false' });
    const second = el('select', { title: 'Give the same task to a second agent in its own worktree, then compare the two results' }, el('option', { value: '', text: 'none' }), ...agents.map((a, i) => el('option', { value: String(i), text: agentLabel(a) })));
    // one click: the local model and a frontier agent get the same task in their own worktrees
    const firstLocal = agents.findIndex(isLocalAgent);
    const firstFrontier = agents.findIndex((a) => !isLocalAgent(a));
    const localVsFrontier = firstLocal >= 0 && firstFrontier >= 0
      ? el('button', { title: 'Same task for both, each in its own worktree; compare the results afterwards', onclick: () => { agentSel.value = String(firstLocal); second.value = String(firstFrontier); } }, ic('git-compare'), `Compare ${agentLabel(agents[firstLocal])} with ${agentLabel(agents[firstFrontier])}`)
      : null;
    const templates = (state.project && state.project.taskTemplates) || [];
    const tplSel = el('select', null, el('option', { value: '', text: 'No template' }), ...templates.map((t, i) => el('option', { value: String(i), text: `${t.name}${t.source === 'built-in' ? '' : ` (${t.source})`}` })));
    tplSel.addEventListener('change', () => {
      const t = templates[Number(tplSel.value)];
      if (!t || tplSel.value === '') return;
      task.value = t.text; if (t.allow) allow.value = t.allow;
      task.focus();
      const m = /<[^<>\n]+>/.exec(t.text); if (m) task.setSelectionRange(m.index, m.index + m[0].length);
    });
    // what your own history says about this kind of task (only when there is enough of it to say anything)
    const advice = el('div', { class: 'hint', id: 'run-advice' });
    const boxCur = (state.project.config && state.project.config.agentContainer) || {};
    const boxOn = el('input', { type: 'checkbox', id: 'run-container' }); boxOn.checked = !!boxCur.enabled;
    const boxNote = el('span', { class: 'hint' });
    api.container.setup().then((r) => {
      if (r && !r.error && !r.ok) { if (!boxCur.enabled) boxOn.disabled = true; boxNote.textContent = ` ${r.text} (Settings → Agent safety)${boxCur.enabled ? ' The run will not start without it, as your settings ask for a container.' : ''}`; }
      else if (r && !r.error) boxNote.textContent = ' Docker and the image are ready.';
    }).catch(() => {});
    let scData = null; let adviceTimer = null;
    api.scorecard.get().then((d) => { scData = d && !d.error ? d : null; showAdvice(); }).catch(() => {});
    const showAdvice = async () => {
      const text = task.value.trim();
      if (!scData || !scData.total || text.length < 8) { advice.replaceChildren(); return; }
      const kind = await api.scorecard.kind(text);
      const rec = scData.recs[kind];
      if (!rec) { advice.replaceChildren(); return; }
      const best = rec.split(':')[0];
      const idx = agents.findIndex((a) => a.name === best);
      advice.replaceChildren(`This looks like a ${scData.labels[kind].toLowerCase()} task. Your history: ${rec}. `, idx >= 0 && String(idx) !== agentSel.value ? el('button', { class: 'link', text: `Use ${best}`, onclick: () => { agentSel.value = String(idx); showAdvice(); } }) : '');
    };
    task.addEventListener('input', () => { clearTimeout(adviceTimer); adviceTimer = setTimeout(showAdvice, 400); });
    const close = () => $('#modal').classList.add('hidden');
    const start = async () => {
      const text = task.value.trim();
      if (!text) { task.focus(); return; }
      const open = unfilledPlaceholder(text, templates);
      if (open) { task.focus(); task.setSelectionRange(open.index, open.index + open.text.length); setStatus(`Fill in ${open.text} first: the template placeholder would be sent to the agent as it is.`); return; }
      const agent = agents[Number(agentSel.value)];
      rememberAgent(agent && agent.name);
      const other = second.value === '' ? null : agents[Number(second.value)];
      const base = name.value.trim() || text.split(/\s+/).slice(0, 5).join(' ');
      close();
      await startRun({ task: text, name: other ? `${base} ${agent.name}` : base, agent, allow: allow.value.trim(), noEscalate: !!other, container: boxOn.checked });
      if (other) {
        await startRun({ task: text, name: `${base} ${other.name === agent.name ? `${other.name} 2` : other.name}`, agent: other, allow: allow.value.trim(), activate: false, noEscalate: true, container: boxOn.checked });
        setStatus('Two runs started with the same task. Use “Compare…” when both are done.');
      }
    };
    $('#dialog').replaceChildren(
      el('h3', { text: 'New agent run' }),
      templates.length ? el('div', { class: 'field' }, el('label', { text: 'Template' }), tplSel) : '',
      el('div', { class: 'field' }, el('label', { text: 'Task' }), task, el('div', { class: 'line' }, el('button', { id: 'run-pull', title: 'Azure Boards or Jira: fill the task from a story or bug', onclick: () => openWorkItems((text, item) => openRunDialog({ task: text, name: `${item.ref || `AB#${item.id}`} ${item.title}`.slice(0, 60) }), () => openRunDialog({ task: task.value }))  }, ic('external-link'), 'Pull in a work item…'))),
      el('div', { class: 'field' }, el('label', { text: 'Agent' }), agentSel, advice),
      el('div', { class: 'field' }, el('label', null, 'Second agent, same task (to compare)', helpQ('Starts a second run with the same task for another agent, each in its own copy. Afterwards “Compare…” shows both results side by side so you keep the better one.')), second, localVsFrontier ? el('div', { class: 'line' }, localVsFrontier) : '', el('div', { class: 'line' }, el('button', { id: 'run-bestof', title: 'The same task for up to six agents, each in its own worktree, then a ranking of the results', onclick: () => openBestOf({ task: task.value, name: name.value }) }, ic('list-ordered'), 'Best of several agents…'))),
      el('div', { class: 'field' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', null, 'Scope', helpQ('Files the agent should stay within, for example src/** . Changes outside it are flagged when you review. Leave empty for no limit.')), allow),
      el('div', { class: 'field' }, el('label', { class: 'check' }, boxOn, ' Run in a Docker container (the agent sees only this run’s folder; credentials from your environment stay out)'), boxNote),
      el('div', { class: 'hint', text: 'A new git worktree and branch (agent/<name>) are created from the current commit, next to the repository. Your own working tree is not touched.' }),
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: start }, ic('play'), 'Start')));
    $('#modal').classList.remove('hidden');
    task.focus();
  }

  /** Azure Boards: pick a work item, and its text (title, description, acceptance criteria) goes to `onPick`. `back` returns to where it came from. */
  async function openWorkItems(onPick, back) {
    const close = () => $('#modal').classList.add('hidden');
    let prov = await api.workitems.providers();
    if (!prov || prov.error) prov = { azure: true, jira: false, jiraSettings: {}, secure: true };
    let provider = prov.azure || !prov.jira ? 'azure' : 'jira';
    const providerSel = el('select', { id: 'wi-provider', title: 'Where the work items come from' }, el('option', { value: 'azure', text: 'Azure Boards' }), el('option', { value: 'jira', text: 'Jira' }));
    providerSel.value = provider;
    const scope = el('select', null, el('option', { value: 'mine', text: 'Assigned to me' }), el('option', { value: 'sprint', text: 'Current sprint (everybody)' }));
    const filter = el('input', { type: 'text', placeholder: 'Filter by number, title or tag', spellcheck: 'false' });
    const listHost = el('div', { class: 'wi-list' });
    const status = el('div', { class: 'hint' });
    const note = el('div', { class: 'hint' });
    let items = [];
    const draw = () => {
      const f = filter.value.trim().toLowerCase();
      const shown = items.filter((w) => !f || `${w.id} ${w.title} ${w.tags} ${w.type}`.toLowerCase().includes(f));
      listHost.replaceChildren(...(shown.length ? shown.map((w) => el('div', { class: 'wi-row', tabindex: '0', title: 'Use this work item', onclick: () => pick(w) },
        el('span', { class: 'chip', text: w.type || 'item' }), el('b', { text: ` ${w.id} ` }), el('span', { text: w.title }), el('span', { class: 'muted', text: `  ${w.state}${w.assignedTo ? ` · ${w.assignedTo}` : ''}` }))) : [el('div', { class: 'empty', text: items.length ? 'Nothing matches the filter.' : 'Nothing to show.' })]));
    };
    const load = async () => {
      provider = providerSel.value;
      note.textContent = provider === 'jira' ? 'Read-only: Jira REST with your saved API token. The summary and description become the task text; the issue key (PROJ-12) links the pull request back.' : 'Read-only: uses the Azure CLI (az boards) and your az login. The title, description and acceptance criteria become the task text; the pull request is linked back through AB#number.';
      status.textContent = provider === 'jira' ? 'Asking Jira…' : 'Asking Azure Boards…'; status.classList.remove('danger'); listHost.replaceChildren();
      const r = await api.workitems.list({ scope: scope.value, provider });
      if (r.error) { status.textContent = r.error; status.classList.add('danger'); items = []; draw(); return; }
      status.textContent = `${r.items.length} open work item${r.items.length === 1 ? '' : 's'} in ${r.project}`; items = r.items; draw();
    };
    const pick = async (w) => {
      status.textContent = `Reading ${provider === 'jira' ? w.id : `#${w.id}`}…`;
      const r = await api.workitems.show(w.id, provider);
      if (r.error) { status.textContent = r.error; status.classList.add('danger'); return; }
      onPick(r.text, { ...r.item, provider, ref: r.item.ref || `AB#${r.item.id}` });
    };
    scope.addEventListener('change', load); filter.addEventListener('input', draw); providerSel.addEventListener('change', load);
    $('#dialog').replaceChildren(el('h3', { text: 'Pull in a work item' }),
      el('div', { class: 'line wrap' }, providerSel, scope, filter, el('button', { id: 'wi-jira-setup', title: 'Base URL, email and API token for Jira Cloud or Server', onclick: () => openJiraSetup(prov.jiraSettings || {}, prov.secure !== false, () => openWorkItems(onPick, back)) }, ic('settings'), 'Set up Jira…')), status, listHost, note,
      el('div', { class: 'actions' }, el('button', { onclick: back || close }, back ? ic('chevron-left') : ic('x'), back ? 'Back' : 'Close')));
    $('#modal').classList.remove('hidden');
    await load();
  }

  /** The Jira connection: the URL, who you are and a token. The token goes to the operating system's key store, never into a file in clear text. */
  function openJiraSetup(cur, secure, done) {
    const close = () => $('#modal').classList.add('hidden');
    const flavor = el('select', { id: 'jira-flavor' }, el('option', { value: 'cloud', text: 'Jira Cloud (yourorg.atlassian.net)' }), el('option', { value: 'server', text: 'Jira Server / Data Center' }));
    flavor.value = cur.flavor === 'server' ? 'server' : 'cloud';
    const url = el('input', { type: 'text', id: 'jira-url', value: cur.baseUrl || '', placeholder: 'https://yourorg.atlassian.net', spellcheck: 'false' });
    const email = el('input', { type: 'text', id: 'jira-email', value: cur.email || '', placeholder: 'you@company.com', spellcheck: 'false' });
    const project = el('input', { type: 'text', id: 'jira-project', value: cur.project || '', placeholder: 'Project key, e.g. PROJ (optional)', spellcheck: 'false' });
    const token = el('input', { type: 'password', id: 'jira-token', placeholder: cur.hasToken ? '(saved: leave empty to keep it)' : 'API token', spellcheck: 'false', autocomplete: 'off' });
    const emailField = el('div', { class: 'field' }, el('label', { text: 'Email of your Atlassian account' }), email);
    const syncFlavor = () => { emailField.classList.toggle('hidden', flavor.value === 'server'); };
    flavor.addEventListener('change', syncFlavor); syncFlavor();
    const msg = el('div', { class: 'hint', id: 'jira-msg' });
    const save = el('button', { class: 'primary', id: 'jira-save', onclick: async () => {
      msg.classList.remove('danger'); msg.textContent = 'Checking the connection…';
      const r = await api.workitems.jiraSave({ flavor: flavor.value, baseUrl: url.value, email: email.value, project: project.value, token: token.value });
      if (r.error) { msg.classList.add('danger'); msg.textContent = r.error; return; }
      msg.textContent = `Connected as ${r.name}.`;
      setTimeout(done, 600);
    } }, ic('check'), 'Save and check');
    $('#dialog').replaceChildren(el('h3', { text: 'Connect Jira' }),
      el('div', { class: 'field' }, el('label', { text: 'Which Jira' }), flavor),
      el('div', { class: 'field' }, el('label', { text: 'Base URL' }), url),
      emailField,
      el('div', { class: 'field' }, el('label', { text: 'API token' }), token, el('div', { class: 'hint', text: 'Cloud: create one at id.atlassian.com → Security → API tokens. Server / Data Center: a personal access token from your profile.' })),
      el('div', { class: 'field' }, el('label', { text: 'Project' }), project),
      secure ? null : el('div', { class: 'hint danger', text: 'This computer has no secure key store available (Keychain, Windows credential store, libsecret), so a token cannot be saved safely and will be refused.' }),
      msg,
      el('div', { class: 'hint', text: 'Read-only: Bazinga only reads issues. The token is stored encrypted with your operating system’s key store.' }),
      el('div', { class: 'actions' }, el('button', { onclick: done }, ic('x'), 'Cancel'), cur.hasToken ? el('button', { class: 'danger', onclick: async () => { await api.workitems.jiraForget(); done(); } }, ic('trash-2'), 'Forget token') : null, save));
    $('#modal').classList.remove('hidden');
    return { close };
  }

  async function openSkills() {
    const close = () => $('#modal').classList.add('hidden');
    const listHost = el('div', { class: 'skills-list' });
    const fetchHost = el('div', { class: 'skills-fetch' });
    const src = el('input', { type: 'text', placeholder: 'owner/repo, owner/repo/path, or a https git URL', spellcheck: 'false', id: 'sk-src' });
    const levelSel = el('select', { id: 'sk-level' }, el('option', { value: 'project', text: 'This project' }), el('option', { value: 'ide', text: 'All projects (IDE level)' }));
    let pending = null;
    const dropPending = () => { if (pending) { api.skills.cancel(pending.token); pending = null; } };
    // small, reusable "visual vocabulary" for this dialog: a coloured icon swatch per source kind, and a chip for badges.
    const skIco = (name, kind) => el('div', { class: `skill-ico src-${kind}` }, ic(name));
    const skBadge = (text, cls, iconName, title) => el('span', { class: `chip ${cls}`, title: title || '' }, iconName ? ic(iconName) : null, text);
    const skHead = (iconName, text) => el('div', { class: 'sk-head' }, ic(iconName), el('span', { text }));
    const row = (level, s) => {
      const isGit = !!(s.provenance && s.provenance.url);
      return el('div', { class: 'skill-row' },
        skIco(isGit ? 'git-branch' : 'folder', isGit ? 'git' : 'manual'),
        el('div', { class: 'skill-main' },
          el('div', { class: 'skill-title' }, el('b', { text: s.name })),
          s.description ? el('div', { class: 'skill-desc', text: s.description }) : null,
          el('div', { class: 'skill-badges' },
            s.source ? skBadge(`${s.source}${s.provenance && s.provenance.commit ? ` @ ${s.provenance.commit.slice(0, 7)}` : ''}`, 'info', 'git-branch')
              : skBadge('added by hand', 'ghost', 'folder'))),
        el('div', { class: 'skill-actions' },
          isGit ? el('button', { title: 'Fetch the source again and replace this skill when it changed', onclick: async () => {
            setStatus(`Updating ${s.name}…`);
            let r = await api.skills.update({ level, name: s.name });
            if (r && !r.error && (r.findings || []).length) {
              const lines = r.findings.map((f) => `${f.file}:${f.line} — ${f.message}`).join('\n');
              if (!window.confirm(`The updated ${s.name} (${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}) scanned with ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}:\n\n${lines}\n\nThis is a heuristic scan, not a security review. Install the update anyway?`)) {
                setStatus(`${s.name} not updated.`); return;
              }
              r = await api.skills.update({ level, name: s.name, token: r.token, force: true });
            }
            setStatus(r.error ? r.error : r.unchanged ? `${s.name} is up to date.` : `${s.name} updated.`); await draw();
          } }, ic('refresh-cw'), 'Update') : null,
          el('button', { class: 'icon danger', title: 'Remove this skill', 'aria-label': `Remove ${s.name}`, onclick: async () => {
            if (!window.confirm(`Remove the skill “${s.name}” (${level === 'ide' ? 'IDE level' : 'this project'})?`)) return;
            const r = await api.skills.remove({ level, name: s.name }); if (r.error) setStatus(r.error); await draw();
          } }, ic('trash-2'))));
    };
    const draw = async () => {
      const r = await api.skills.list();
      if (r.error) { fill(listHost, el('div', { class: 'hint danger', text: r.error })); return; }
      const bundled = await api.skills.listBundled();
      const installedNames = new Set([...r.project, ...r.ide].map((x) => x.name));
      const projNames = new Set(r.project.map((x) => x.name));
      fill(listHost,
        skHead('package', 'Recommended skills'),
        ...((bundled.skills || []).length ? bundled.skills.map((b) => el('div', { class: 'skill-row' },
          skIco('package', 'bundled'),
          el('div', { class: 'skill-main' },
            el('div', { class: 'skill-title' }, el('b', { text: b.name })),
            b.description ? el('div', { class: 'skill-desc', text: b.description }) : null,
            el('div', { class: 'skill-badges' }, skBadge('Bundled with Bazinga', 'accent', 'package', 'A local copy, not a git fetch'))),
          el('div', { class: 'skill-actions' },
            installedNames.has(b.name) ? skBadge('Installed', 'ok', 'check') : el('button', { class: 'primary', onclick: async () => {
              const level = levelSel.value;
              const res = await api.skills.installBundled({ level, name: b.name, replace: true });
              setStatus(res.error ? res.error : `Installed ${res.installed}.`); await draw();
            } }, ic('download'), 'Install')))) : [el('div', { class: 'muted', text: 'None.' })]),
        skHead('folder', `This project (${r.project.length})`),
        ...(r.project.length ? r.project.map((x) => row('project', x)) : [el('div', { class: 'muted', text: 'None. Skills here are committed with the project and win over IDE-level skills of the same name.' })]),
        skHead('folder-open', `All projects, IDE level (${r.ide.length})`),
        ...(r.ide.length ? r.ide.map((x) => row('ide', x)) : [el('div', { class: 'muted', text: 'None.' })]),
        el('div', { class: 'hint', text: `Also copied to: ${[...r.also.project, ...r.also.ide].join(' · ') || '(nowhere: set “skillsMirrors”)'}. Claude Code reads .claude/skills, Copilot reads .agents/skills; agents without skill support are pointed to the project skills through AGENTS.md.` }),
        el('div', { class: 'hint', text: `Folders: ${r.dirs.project || '(no project)'} · ${r.dirs.ide}${[...r.ide].some((x) => projNames.has(x.name)) ? ' · some IDE skills are overridden by the project' : ''}` }));
    };
    const showFetched = (res, want = '') => {
      pending = res;
      const checks = res.skills.map((k) => { const c = el('input', { type: 'checkbox' }); c.checked = res.skills.length === 1 || (!!want && k.name.toLowerCase() === want.toLowerCase()); c.dataset.name = k.name; return c; });
      fill(fetchHost,
        skHead('git-branch', `${res.label} @ ${res.commit.slice(0, 7)}: ${res.skills.length} skill${res.skills.length === 1 ? '' : 's'}`),
        ...res.skills.map((k, i) => el('div', { class: 'skill-cand' },
          el('label', { class: 'check skill-cand-row' },
            checks[i],
            skIco('file-code', 'git'),
            el('div', { class: 'skill-main' },
              el('div', { class: 'skill-title' }, el('b', { text: k.name })),
              k.description ? el('div', { class: 'skill-desc', text: k.description }) : null,
              el('div', { class: 'skill-badges' },
                skBadge(`${k.fileCount} file${k.fileCount === 1 ? '' : 's'}`, 'ghost', 'files'),
                k.hasScripts ? skBadge('Contains scripts', 'danger', 'triangle-alert', 'Other than text - an agent may run them. Read them before you install.') : null,
                (k.findings || []).length ? skBadge(
                  `${k.findings.length} scan finding${k.findings.length === 1 ? '' : 's'}`,
                  k.findings.some((f) => f.severity === 'error') ? 'danger' : 'warnchip',
                  'triangle-alert',
                  'A read-only pattern scan of this skill’s own files (hidden/invisible characters, download-and-execute commands, prompt-injection phrasing). This is heuristic, not a security review - read the findings yourself before installing.',
                ) : null))),
          (k.findings || []).length ? el('details', { class: 'skill-scan-findings' }, el('summary', { text: `Scan findings (${k.findings.length})` }),
            ...k.findings.map((f) => el('div', { class: 'finding' }, el('span', { class: `sev ${f.severity}`, text: f.severity === 'error' ? '!' : '?' }), el('span', { text: `${f.file}:${f.line} — ${f.message}` })))) : null,
          el('details', null, el('summary', { text: 'Preview SKILL.md' }), el('pre', { class: 'detail', text: `${k.files.join('\n')}\n\n${k.preview}` })))),
        el('div', { class: 'actions' },
          el('button', { onclick: () => { dropPending(); fill(fetchHost); } }, ic('x'), 'Cancel'),
          el('button', { class: 'primary', onclick: async () => {
            const names = checks.filter((c) => c.checked).map((c) => c.dataset.name);
            if (!names.length) return;
            const level = levelSel.value;
            const flagged = res.skills.filter((k) => names.includes(k.name) && (k.findings || []).length);
            const scanNote = flagged.length ? `\n\n⚠ The read-only scan flagged ${flagged.reduce((n, k) => n + k.findings.length, 0)} thing${flagged.length === 1 && flagged[0].findings.length === 1 ? '' : 's'} in ${flagged.map((k) => k.name).join(', ')} - see “Scan findings” above before installing.` : '';
            if (!window.confirm(`Install ${names.join(', ')} for ${level === 'ide' ? 'all projects' : 'this project'}?\n\nSkills are instructions (and sometimes scripts) your agent will follow. Only install ones you trust.${scanNote}`)) return;
            const r = await api.skills.install({ token: res.token, names, level, replace: true });
            pending = null; fill(fetchHost);
            setStatus(r.error ? r.error : `Installed ${r.installed.join(', ')}.`); await draw();
          } }, ic('download'), 'Install selected')));
    };
    const doFetch = async (want = '') => {
      dropPending();
      fill(fetchHost, el('div', { class: 'muted', text: 'Fetching…' }));
      const r = await api.skills.fetch(src.value);
      if (r.error) { fill(fetchHost, el('div', { class: 'hint danger', text: r.error })); return; }
      showFetched(r, typeof want === 'string' ? want : '');
    };
    src.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFetch(); });
    const q = el('input', { type: 'text', id: 'sk-q', placeholder: 'Search skills.sh, for example: spring boot testing', spellcheck: 'false' });
    const found = el('div', { class: 'skills-found' });
    let searchTimer = null; let searchSeq = 0;
    const runSearch = async () => {
      const text = q.value.trim(); const seq = ++searchSeq;
      if (text.length < 2) { fill(found); return; }
      fill(found, el('div', { class: 'muted', text: 'Searching skills.sh…' }));
      const r = await api.skills.search(text);
      if (seq !== searchSeq) return; // a newer search is on its way
      if (r.error) { fill(found, el('div', { class: 'hint danger', text: r.error })); return; }
      if (!r.results.length) { fill(found, el('div', { class: 'muted', text: 'Nothing found.' })); return; }
      fill(found, ...r.results.slice(0, 12).map((s) => el('div', { class: 'skill-hit' },
        skIco('globe', 'web'),
        el('div', { class: 'skill-main' },
          el('div', { class: 'skill-title' }, el('b', { text: s.name })),
          el('div', { class: 'skill-badges' },
            skBadge(s.source, 'ghost'),
            skBadge(`${s.installs.toLocaleString()} installs`, 'info', 'download'))),
        el('div', { class: 'skill-actions' },
          s.installable ? el('button', { class: 'primary', title: 'Download the repository, show what is in it and ask before installing', onclick: () => { src.value = s.source; doFetch(s.slug); } }, ic('eye'), 'Preview…')
            : skBadge('not from GitHub', 'ghost', null, 'Only GitHub repositories (owner/repo) can be installed here')))),
      el('div', { class: 'hint', text: 'Anybody can publish a skill. A skill is instructions (sometimes scripts) your agent follows: read the preview before you install.' }));
    };
    q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
    $('#dialog').replaceChildren(el('h3', { class: 'ico-head' }, ic('package'), ' Agent skills'),
      listHost,
      skHead('globe', 'Find skills on the internet (skills.sh)'),
      el('div', { class: 'line' }, q), found,
      skHead('git-branch', 'Or add from a git repository (skills.sh style)'),
      el('div', { class: 'line' }, src, levelSel, el('button', { onclick: doFetch }, ic('download'), 'Fetch')),
      fetchHost,
      el('div', { class: 'hint', text: 'Skills are plain folders with a SKILL.md, installed next to your agent’s own skills (setting “skillsDir”, default .claude/skills). Nothing is executed by the IDE.' }),
      el('div', { class: 'actions' },
        el('button', { id: 'sk-sync', title: 'Copy skills installed earlier to the other agents’ folders and refresh the AGENTS.md list', onclick: async () => {
          const r = await api.skills.sync();
          setStatus(r.error ? r.error : r.copied.length ? `Copied ${r.copied.length} skill folder${r.copied.length === 1 ? '' : 's'}.` : 'Everything was already in sync.'); await draw();
        } }, ic('refresh-cw'), 'Sync to other agents'),
        el('button', { class: 'primary', onclick: () => { dropPending(); close(); } }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
    await draw();
  }

  // ---------------------------------------------------------------- agent configuration: MCP servers, skills, agents,
  // hooks and instructions files, aggregated across every runner found in the project (core/agentconfig.js)
  async function openAgentConfig() {
    const close = () => { if (unsub) unsub(); $('#modal').classList.add('hidden'); };
    let unsub = null;
    let last = null; // last api.agentconfig.scan() result, so filtering re-renders without re-scanning
    let query = '';
    const RUNNER_LABEL = { claude: 'Claude Code', codex: 'Codex', copilot: 'GitHub Copilot', gemini: 'Gemini CLI' };
    const CATEGORY = {
      mcp: { label: 'MCP servers', icon: 'link' },
      skill: { label: 'Skills', icon: 'package' },
      agent: { label: 'Agents', icon: 'bot' },
      hook: { label: 'Hooks', icon: 'command' },
      instructions: { label: 'Instructions', icon: 'file-text' },
    };
    const acIco = (name) => el('div', { class: 'skill-ico src-manual' }, ic(name));
    const DESC_CUT = 140; // past this length, descriptions (often third-party SKILL.md text) collapse to one rendered line until "more" is clicked
    const descNode = (text) => {
      if (!text) return null;
      const line = el('div', { class: 'skill-desc clamp', text });
      if (text.length <= DESC_CUT) return line;
      let open = false;
      const btn = el('button', { class: 'desc-more', type: 'button', text: 'more', onclick: (e) => {
        e.stopPropagation();
        open = !open;
        line.classList.toggle('clamp', !open);
        btn.textContent = open ? 'less' : 'more';
      } });
      return el('div', {}, line, btn);
    };
    // a hook's command is implementation detail (a raw shell string, often with local absolute paths) - not prose,
    // so it stays behind a toggle instead of being shown inline as if it were a human-written description
    const hookCmdNode = (cmds) => {
      if (!cmds || !cmds.length) return null;
      const pre = el('code', { class: 'hook-cmd hidden', text: cmds.join('\n') });
      const btn = el('button', { class: 'desc-more', type: 'button', text: `view command${cmds.length > 1 ? 's' : ''}`, onclick: (e) => {
        e.stopPropagation();
        const open = pre.classList.toggle('hidden') === false;
        btn.textContent = open ? `hide command${cmds.length > 1 ? 's' : ''}` : `view command${cmds.length > 1 ? 's' : ''}`;
      } });
      return el('div', {}, btn, pre);
    };
    const itemMatches = (item) => !query || `${item.name} ${item.description || ''} ${item.file || ''}`.toLowerCase().includes(query);
    const itemRow = (item) => {
      const hookCmds = item.category === 'hook' && item.detail && item.detail.commands ? item.detail.commands.filter(Boolean) : null;
      return el('div', { class: 'skill-row' },
        acIco((CATEGORY[item.category] || {}).icon || 'file'),
        el('div', { class: 'skill-main' },
          el('div', { class: 'skill-title' }, el('b', { text: item.name })),
          descNode(item.description),
          hookCmdNode(hookCmds),
          el('div', { class: 'skill-badges' }, el('span', { class: 'chip ghost', text: item.file }))));
    };
    const byCategory = (its) => {
      const byCat = new Map();
      for (const it of its) { if (!byCat.has(it.category)) byCat.set(it.category, []); byCat.get(it.category).push(it); }
      return [...byCat.entries()].flatMap(([cat, g]) => [el('div', { class: 'sk-head' }, ic((CATEGORY[cat] || {}).icon || 'file'), el('span', { text: (CATEGORY[cat] || {}).label || cat })), ...g.map(itemRow)]);
    };
    const listHost = el('div', { class: 'skills-list' });
    const render = () => {
      if (!last) return;
      if (last.error) { fill(listHost, el('div', { class: 'hint danger', text: last.error })); return; }
      const runners = last.runners || {};
      const blocks = [];
      let anyMatch = false;
      const shared = (last.shared || []).filter(itemMatches);
      if (shared.length) { anyMatch = true; blocks.push(el('details', { open: true }, el('summary', null, ic('file-text'), ' Shared across agents'), ...shared.map(itemRow))); }
      for (const key of ['claude', 'codex', 'copilot', 'gemini']) {
        const items = (runners[key] && runners[key].items) || [];
        const project = items.filter((it) => it.scope !== 'global' && itemMatches(it));
        const global = items.filter((it) => it.scope === 'global' && itemMatches(it));
        if (query && !project.length && !global.length) continue; // hide runners with no match while filtering
        if (project.length || global.length) anyMatch = true;
        const body = items.length
          ? [
              ...byCategory(project),
              global.length ? el('details', { class: 'ac-global', open: query ? true : undefined }, el('summary', null, ic('globe'), ` Global (~, every project on this machine) · ${global.length}`), ...byCategory(global)) : null,
            ].filter(Boolean)
          : [el('div', { class: 'muted', text: 'No config detected.' })];
        const openByDefault = query ? (project.length || global.length) : !!project.length;
        blocks.push(el('details', openByDefault ? { open: true } : null, el('summary', null, ic('bot'), ` ${RUNNER_LABEL[key]} (${items.length})`), ...body));
      }
      if (query && !anyMatch) blocks.push(el('div', { class: 'muted', text: `No matches for "${query}".` }));
      fill(listHost, ...blocks);
    };
    const draw = async () => {
      last = await api.agentconfig.scan();
      render();
    };
    const filterInput = el('input', { class: 'ac-filter', type: 'search', placeholder: 'Filter by name, description or file…', oninput: (e) => { query = e.target.value.trim().toLowerCase(); render(); } });
    $('#dialog').replaceChildren(el('div', { class: 'ac-wrap' },
      el('h3', { class: 'ico-head' }, ic('link'), ' Agent configuration'),
      el('div', { class: 'hint', text: 'MCP servers, skills, agents, hooks and instructions files found for Claude Code, Codex, GitHub Copilot and Gemini CLI - both this project’s own config and each tool’s global, home-directory config. Refreshes automatically when a config file changes.' }),
      filterInput,
      listHost,
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close'))));
    $('#modal').classList.remove('hidden');
    await draw();
    unsub = api.fs.onChanged(() => draw());
  }

  // ---------------------------------------------------------------- workflows: chained agent steps (core/workflow.js)
  state.workflows = new Map();
  const wfStepStatus = (st, id) => (st.steps[id] && st.steps[id].status) || 'waiting';
  const wfApprovalDefault = () => { const o = state.project && state.project.oversight; return !!(o && (o.level === 'guided' || o.level === 'stepwise')); };
  async function wfPersist(st) { await api.workflow.save(st); renderWorkflows(); }
  async function loadWorkflows() {
    if (!state.project || !state.project.isRepo) { state.workflows = new Map(); renderWorkflows(); return; }
    const r = await api.workflow.load();
    state.workflows = new Map(((r && r.states) || []).map((s) => [s.id, s]));
    renderWorkflows();
  }
  /** The agent (button) that remembers what you used last: the default for workflow steps that name none. */
  const lastAgentName = () => { try { return localStorage.getItem('bazinga.lastAgent') || ''; } catch { return ''; } };
  const rememberAgent = (name) => { try { if (name) localStorage.setItem('bazinga.lastAgent', String(name)); } catch { /* no storage */ } };
  /** Which agent runs a workflow step: chosen for the step when starting > set in the workflow file > the default chosen when starting > the one used last > the first. */
  function pickWorkflowAgent(step, st, agents) {
    const by = (n) => agents.find((a) => a.name === n);
    const chosen = (st && st.agents) || {};
    const tries = [[chosen.steps && chosen.steps[step.id], 'chosen for this step'], [step.agent, 'set in the workflow'], [chosen.default, 'your default for this workflow'], [lastAgentName(), 'the one you used last']];
    for (const [n, why] of tries) if (n && by(n)) return { agent: by(n), why, missing: step.agent && !by(step.agent) ? step.agent : '' };
    return { agent: agents[0] || null, why: 'the first agent', missing: step.agent && !by(step.agent) ? step.agent : '' };
  }
  async function wfRunFor(id) {
    if (!state.runs || !state.runs.runs.some((r) => r.id === id)) await refreshRuns();
    return state.runs.runs.find((r) => r.id === id) || null;
  }
  /** Start every step that may start now. */
  async function wfAdvance(st) {
    const plan = await api.workflow.plan(st);
    dbg('workflow', `${st.name}: advance, start [${(plan.start || []).map((x) => x.id).join(', ')}]${plan.error ? ` error: ${plan.error}` : ''}${plan.reason ? ` (${plan.reason})` : ''}; steps ${st.workflow.steps.map((x) => `${x.id}=${wfStepStatus(st, x.id)}`).join(' ')}`);
    if (plan.error) { setStatus(plan.error); return; }
    const agents = (state.project.config && state.project.config.agents) || [];
    let cc = (state.project.config && state.project.config.agentContainer) || {};
    if (st.mode === 'unattended' && plan.start.length && cc.enabled !== true) {
      // nobody is watching: use the container when it is ready (the Docker image built), otherwise run as before and say so once
      let ready = false; try { const r = await api.container.setup(); ready = !!(r && !r.error && r.ok); } catch { ready = false; }
      const dec = containerDecisionUi({ enabled: false, unattended: true, setting: state.project.config && state.project.config.containerWhenUnattended, ready });
      if (dec.use) { cc = { ...cc, enabled: true }; dbg('workflow', `${st.name}: unattended, so the steps run in the Docker container`); }
      else if (dec.why === 'not-ready' && !st.containerHinted) { st.containerHinted = true; setStatus('Tip: unattended runs are safer in a Docker container. “Setup & health” can set it up in one click.'); }
    }
    for (const step of plan.start) {
      const picked = pickWorkflowAgent(step, st, agents);
      const agent = picked.agent;
      dbg('workflow', `step ${step.id}: agent ${agent ? agent.name : 'none'} (${picked.why})${picked.missing ? `, “${picked.missing}” is not configured` : ''}; task: ${String(step.rendered || '').slice(0, 160)}`);
      if (!agent) { setStatus('No agent is configured.'); return; }
      if (picked.missing) setStatus(`Step ${step.id}: the agent “${picked.missing}” is not configured any more, so ${agentLabel(agent)} (${picked.why}) is used.`);
      let run = null;
      const prior = st.steps[step.id];
      if (prior && prior.runId) run = await wfRunFor(prior.runId); // a retry continues in its own worktree
      const dep = step.needs.length === 1 ? st.steps[step.needs[0]] : null;
      if (!run && dep && dep.runId) run = await wfRunFor(dep.runId); // one dependency: continue in the same worktree
      if (!run) {
        const res = await api.runs.create({ name: `${st.name}: ${step.id}`.slice(0, 60), task: step.rendered, agent: agent.name, allow: step.allow });
        if (res.error) { st.steps[step.id] = { status: 'failed', why: res.error }; await wfPersist(st); return; }
        run = res.run;
      }
      dbg('workflow', `step ${step.id}: ${prior && prior.runId ? 'retry in' : (dep && dep.runId && run && run.id === dep.runId ? 'continuing in the worktree of the previous step,' : 'new')} run ${run.id}`);
      const retryOfGate = !!(prior && prior.feedback); // unattended step: the gate failed, the agent starts again with the findings
      const taskText = retryOfGate ? `${step.rendered}\n\n${prior.feedback}` : step.rendered;
      st.steps[step.id] = { status: 'running', runId: run.id, attempts: retryOfGate ? (prior.attempts || 2) : 1, startedAt: Date.now() };
      await wfPersist(st);
      const entry = await launchAgent(run, agent, taskText, cc, { unattended: st.mode === 'unattended', workflow: true });
      dbg('workflow', `step ${step.id}: agent launched, terminal ${entry ? entry.id : 'none'}`);
      if (!entry) { st.steps[step.id] = { status: 'failed', runId: run.id, why: 'the agent could not be started' }; await wfPersist(st); return; }
      entry.wf = { wfId: st.id, stepId: step.id };
      dbg('workflow', `step ${step.id}: linked to terminal ${entry.id}; now waiting for the agent to go quiet`);
      renderWorkflows(); // the step's buttons need the terminal that was just linked
      await refreshRuns();
    }
    const all = st.workflow.steps.every((s) => ['passed', 'skipped'].includes(wfStepStatus(st, s.id)));
    if (all && !st.finished) {
      st.finished = Date.now();
      let tail = 'Review and merge the run(s) from the list.';
      if (st.finish === 'merge') {
        const runIds = st.workflow.steps.map((s) => (st.steps[s.id] || {}).runId).filter(Boolean);
        dbg('workflow', `${st.name}: all steps passed, merging ${runIds.length} run(s) because the merge guard is the only judge`);
        const fin = await api.workflow.finish({ runIds, name: st.name });
        if (fin.error) { st.finishNote = `Merge did not happen: ${fin.error}`; }
        else if (fin.stopped) { st.finishNote = `Not merged: ${fin.name || fin.stopped}${fin.reason ? ` (${fin.reason})` : ''}. Review it and merge from the list.`; }
        else { st.finishNote = `Merged ${fin.merged.map((m) => m.name).join(', ')}${fin.merged[0] && fin.merged[0].into ? ` into ${fin.merged[0].into}` : ''}.`; await renderTree(); await refreshChanges(); await loadProject(); }
        dbg('workflow', `${st.name}: finish: ${st.finishNote}`);
        tail = st.finishNote;
      }
      if (st.workItem) {
        const text = `Bazinga workflow “${st.name}” finished: ${st.workflow.steps.map((s2) => `${s2.id} ${wfStepStatus(st, s2.id)}`).join(', ')}.${st.finishNote ? ` ${st.finishNote}` : ' The result is waiting for review.'}`;
        const posted = await api.workitems.comment({ provider: st.workItem.provider, id: st.workItem.id, text });
        st.commentNote = posted.error ? `Could not comment on ${st.workItem.ref || st.workItem.id}: ${posted.error}` : `Commented on ${st.workItem.ref || st.workItem.id}.`;
        tail = `${tail} ${st.commentNote}`;
      }
      await wfPersist(st); await refreshRuns();
      setStatus(`Workflow “${st.name}” finished. ${tail}`); api.notify({ kind: 'agent-idle', title: `Workflow finished: ${st.name}`, body: st.finish === 'merge' ? tail : 'All steps passed.' });
    }
  }
  /** A workflow whose steps use {input} cannot start with an empty input: the agent would get "Refactor: . Behaviour must not change." */
  function workflowNeedsInput(workflow, input) {
    return !String(input || '').trim() && ((workflow && workflow.steps) || []).some((s) => String(s.task || '').includes('{input}'));
  }
  async function wfStartNew(def, input, agents = null, opts = {}) {
    const st = { id: `wf-${Date.now().toString(36)}`, name: def.name, source: def.source, workflow: def.workflow, input: String(input || ''), created: Date.now(), steps: {}, mode: opts.mode || (def.workflow && def.workflow.mode) || 'interactive', finish: opts.finish || (def.workflow && def.workflow.finish) || 'none', ...(opts.workItem ? { workItem: opts.workItem } : {}), ...(agents ? { agents } : {}) };
    state.workflows.set(st.id, st);
    await wfPersist(st);
    await wfAdvance(st);
  }
  /** A step's agent went quiet: check its gate and decide what happens next. */
  async function wfOnIdle(entry, { force = false, exitCode = null } = {}) {
    const st = state.workflows.get(entry.wf.wfId);
    const step = st && st.workflow.steps.find((s) => s.id === entry.wf.stepId);
    if (!st || !step || wfStepStatus(st, step.id) !== 'running' || (entry.prompt && !force)) {
      dbg('workflow', `idle ignored for step ${entry.wf.stepId}: ${!st || !step ? 'workflow or step not found' : wfStepStatus(st, step.id) !== 'running' ? `step is ${wfStepStatus(st, step.id)}, not running` : 'the agent looks like it is asking a question (use Done if it is not)'}`);
      return;
    }
    dbg('workflow', `step ${step.id}: agent went quiet${force ? ' (Done pressed or stall fallback)' : ''}; checking gate “${step.gate}”`);
    const cur = { ...st.steps[step.id], quietAt: Date.now(), signal: entry.signal || 'forced' };
    st.steps[step.id] = { ...cur, status: 'awaiting-gate' };
    await wfPersist(st);
    const g = exitCode !== null && exitCode !== 0 ? { passed: false, why: `the agent ended with exit code ${exitCode}` } : await api.workflow.gate({ runId: cur.runId, gate: step.gate, step: step.id });
    const gatePassed = !g.error && g.passed;
    const next = await api.workflow.after({ step, gatePassed, attempts: cur.attempts || 1, approvalDefault: wfApprovalDefault() });
    dbg('workflow', `step ${step.id}: gate ${gatePassed ? 'passed' : 'FAILED'}${g.error ? ` (error: ${g.error})` : g.why ? ` (${g.why})` : ''}${(g.files || []).length ? `; ${g.files.length} changed file(s)` : ''} -> ${next.status}${next.retry ? ' (sending findings back to the agent)' : ''}${next.reason ? `: ${next.reason}` : ''}`);
    if (next.retry) {
      const msg = `The gate "${step.gate}" failed: ${g.error || g.why || ''}.${(g.findings || []).length ? `\n${g.findings.join('\n')}` : ''}\nPlease fix this and continue with the step.`;
      if (entry.printMode) { // the process has ended: start the agent again in the same worktree with the findings
        st.steps[step.id] = { ...cur, status: 'waiting', attempts: (cur.attempts || 1) + 1, why: g.why, feedback: msg };
        await wfPersist(st);
        dbg('workflow', `step ${step.id}: unattended agent started again with the findings (attempt ${(cur.attempts || 1) + 1})`);
        await wfAdvance(st);
        return;
      }
      st.steps[step.id] = { ...cur, status: 'running', attempts: (cur.attempts || 1) + 1, why: g.why };
      if (entry.id !== null) { api.pty.write(entry.id, `\x1b[200~${msg}\x1b[201~`); setTimeout(() => api.pty.write(entry.id, '\r'), 150); }
    } else {
      st.steps[step.id] = { ...cur, status: next.status, why: next.status === 'failed' ? (g.why || g.error || next.reason) : '' };
      if (next.status === 'awaiting-approval') api.notify({ kind: 'agent-idle', title: `${st.name}: approve “${step.id}”?`, body: 'The step passed its gate. Waiting for your OK.' });
      if (next.status === 'failed') api.notify({ kind: 'agent-idle', title: `${st.name}: step “${step.id}” failed`, body: st.steps[step.id].why || '' });
    }
    await wfPersist(st);
    if (next.status === 'passed') { dbg('workflow', `step ${step.id}: passed, starting what comes next`); await wfAdvance(st); }
  }
  api.onAgentIdle((id, info) => { for (const t of state.terms.values()) if (t.id === id) t.signal = info && info.hook ? 'hook' : 'quiet'; for (const t of state.terms.values()) if (t.id === id && info && info.hook) t.prompt = null; for (const t of state.terms.values()) if (t.id === id) dbg('idle', `window heard: terminal ${id} (${t.title}) is idle${info && info.hook ? ' (Claude Code said it finished)' : ' (guessed from a quiet terminal)'}${t.wf ? `, linked to workflow step ${t.wf.stepId}` : ', not part of a workflow'}`); for (const t of state.terms.values()) if (t.id === id && t.wf) wfOnIdle(t).catch((e) => setStatus(`Workflow: ${e.message}`)); });

  async function wfAction(st, stepId, action) {
    const cur = st.steps[stepId] || {};
    dbg('workflow', `button: ${action}${stepId ? ` on step ${stepId}` : ''} (was ${cur.status || 'n/a'})`);
    if (action === 'approve') { st.steps[stepId] = { ...cur, status: 'passed' }; await wfPersist(st); await wfAdvance(st); }
    else if (action === 'done') { const e = wfEntry(st, stepId); if (e) { if (e.prompt) { e.prompt = null; renderBottomTabs(); } await wfOnIdle(e, { force: true }); } }
    else if (action === 'resume') {
      st.steps[stepId] = { ...cur, status: 'waiting', attempts: cur.attempts || 1, feedback: 'You were interrupted while working on this step (the IDE was restarted). Look at the changes already made in this worktree, do not redo them, and finish the step.' };
      await wfPersist(st); await wfAdvance(st);
    }
    else if (action === 'skip') { st.steps[stepId] = { ...cur, status: 'skipped' }; await wfPersist(st); await wfAdvance(st); }
    else if (action === 'retry') {
      const run = await wfRunFor(cur.runId);
      const step = st.workflow.steps.find((s) => s.id === stepId);
      st.steps[stepId] = { runId: cur.runId, status: 'waiting', attempts: 0 };
      if (run) { /* same worktree: the step starts again there */ st.steps[stepId].status = 'waiting'; }
      await wfPersist(st);
      if (step) await wfAdvance(st);
    }
    else if (action === 'remove') { if (!window.confirm(`Forget the workflow “${st.name}”? Its runs and branches stay.`)) return; state.workflows.delete(st.id); await api.workflow.remove(st.id); renderWorkflows(); }
  }
  /** A step that is still running after its time limit is stopped, and fails: a runaway agent should not work for an hour. */
  async function wfTimedOut(st, step, entry) {
    const cur = st.steps[step.id] || {};
    if (cur.status !== 'running') return;
    dbg('workflow', `step ${step.id}: still running after ${step.timeout} minutes, stopped`);
    st.steps[step.id] = { ...cur, status: 'failed', why: `stopped after ${step.timeout} minutes (the time limit of this step)` };
    if (entry && entry.id !== null && !entry.exited) api.pty.kill(entry.id);
    await wfPersist(st);
    api.notify({ kind: 'agent-idle', title: `${st.name}: step “${step.id}” timed out`, body: `It ran longer than ${step.timeout} minutes and was stopped.` });
  }
  /** A workflow step whose terminal has printed nothing for `ms` (the detector in the main process missed it): treat it as finished. */
  const wfStalled = (entry, now, ms = 90000) => !!entry && !entry.exited && !entry.prompt && !!entry.lastData && now - entry.lastData > ms;
  setInterval(() => {
    for (const st of state.workflows.values()) for (const step of st.workflow.steps) {
      if (wfStepStatus(st, step.id) !== 'running') continue;
      const e = wfEntry(st, step.id);
      if (step.timeout && (st.steps[step.id] || {}).startedAt && Date.now() - st.steps[step.id].startedAt > step.timeout * 60000) { wfTimedOut(st, step, e).catch((err) => setStatus(`Workflow: ${err.message}`)); continue; }
      if (e && e.printMode) continue; // the end of the process is the signal; its terminal is quiet by design
      if (e && !e.exited && !e.prompt && e.lastData && Date.now() - e.lastData > 30000 && !e.quietLogged) { e.quietLogged = true; dbg('workflow', `step ${step.id}: terminal has printed nothing for 30s and no idle event arrived yet (the stall fallback fires at 90s)`); }
      if (e && e.lastData && Date.now() - e.lastData < 5000) e.quietLogged = false;
      if (wfStalled(e, Date.now(), e && e.hooked ? 300000 : 90000)) { dbg('workflow', `step ${step.id}: stall fallback fired (${e.hooked ? '5 minutes' : '90s'} without output)`); e.lastData = 0; wfOnIdle(e).catch((err) => setStatus(`Workflow: ${err.message}`)); }
    }
  }, 5000);
  const wfEntry = (st, stepId) => [...state.terms.values()].find((t) => !t.exited && t.wf && t.wf.wfId === st.id && t.wf.stepId === stepId) || null;
  const wfLive = (st, stepId) => [...state.terms.values()].some((t) => !t.exited && t.wf && t.wf.wfId === st.id && t.wf.stepId === stepId);
  const WF_LABEL = { waiting: 'waiting', ready: 'ready', running: 'running', 'awaiting-gate': 'checking gate', 'awaiting-approval': 'needs your OK', passed: 'passed', failed: 'failed', skipped: 'skipped' };
  function renderWorkflows() {
    const host = $('#a-workflows');
    if (!host) return;
    const list = [...state.workflows.values()];
    host.replaceChildren(...list.map((st) => el('div', { class: 'wf' },
      el('div', { class: 'run-title' }, ic('workflow'), el('span', { class: 'name', text: st.name }), st.finished ? el('span', { class: 'chip on', text: 'finished' }) : null,
        el('button', { class: 'icon', title: 'Forget this workflow', 'aria-label': 'Forget workflow', onclick: () => wfAction(st, null, 'remove') }, ic('x'))),
      (() => { const h = el('div', { class: 'wf-graph-host' }); drawWorkflowGraph(h, st.workflow.steps, (id) => wfStepStatus(st, id)); return h; })(),
      (st.mode === 'unattended' || st.finish === 'merge') ? el('div', { class: 'run-sub muted', text: [st.mode === 'unattended' ? 'unattended (claude -p)' : '', st.finish === 'merge' ? 'merges when the guard is clean' : ''].filter(Boolean).join(' · ') }) : null,
      st.finishNote ? el('div', { class: 'run-sub', text: st.finishNote }) : null,
      st.commentNote ? el('div', { class: 'run-sub muted', text: st.commentNote }) : null,
      st.input ? el('div', { class: 'run-sub muted', text: st.input.length > 100 ? `${st.input.slice(0, 100)}…` : st.input }) : null,
      ...st.workflow.steps.map((step) => {
        const status = wfStepStatus(st, step.id);
        const info = st.steps[step.id] || {};
        return el('div', { class: `wf-step wf-${status}` },
          el('span', { class: 'wf-dot' }), el('span', { class: 'wf-id', text: step.id }), el('span', { class: 'chip', text: WF_LABEL[status] || status }),
          info.attempts > 1 ? el('span', { class: 'muted', text: `attempt ${info.attempts}` }) : null,
          info.quietAt && ['awaiting-gate', 'awaiting-approval', 'passed', 'failed'].includes(status) ? el('span', { class: 'muted', title: 'When Bazinga saw the agent go quiet and checked this step', text: `quiet ${new Date(info.quietAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }) : null,
          info.why ? el('span', { class: 'muted', title: info.why, text: info.why.slice(0, 50) }) : null,
          status === 'running' && wfEntry(st, step.id) && wfEntry(st, step.id).prompt ? el('span', { class: 'chip warnchip', title: wfEntry(st, step.id).prompt.text, text: 'looks like a question' }) : null,
          status === 'running' && wfEntry(st, step.id) ? el('button', { class: 'wf-done', title: 'The agent is finished: check this step’s gate now and go on. Use it when the agent stopped but the workflow did not notice.', onclick: () => wfAction(st, step.id, 'done') }, ic('check'), 'Done') : null,
          status === 'awaiting-approval' ? el('button', { class: 'primary', onclick: () => wfAction(st, step.id, 'approve') }, ic('check-check'), 'Approve') : null,
          status === 'failed' ? el('button', { title: 'Start this step’s agent again', onclick: () => wfAction(st, step.id, 'retry') }, ic('refresh-cw'), 'Retry') : null,
          ['running', 'awaiting-gate'].includes(status) && !wfLive(st, step.id) ? el('button', { class: 'wf-resume', title: 'The agent of this step is gone (the IDE was restarted or the terminal closed). Start it again in the same worktree; it is told to look at what is already done and finish the step.', onclick: () => wfAction(st, step.id, 'resume') }, ic('play'), 'Resume') : null,
          ['failed', 'awaiting-approval', 'waiting', 'running'].includes(status) ? el('button', { onclick: () => wfAction(st, step.id, 'skip') }, ic('fast-forward'), 'Skip') : null,
          info.runId ? el('button', { class: 'icon', title: 'Review this step’s run', 'aria-label': 'Review', onclick: async () => { const r = await wfRunFor(info.runId); if (r) reviewRun(r); } }, ic('eye')) : null);
      }))));
  }

  const WF_GATE_LABELS = { none: 'No check', 'tests-added': 'A test must be added or changed', 'tests-untouched': 'Existing tests must stay untouched', guard: 'The merge guard must have no blockers', changed: 'The agent must have changed files', refactor: 'Files changed, and existing tests untouched' };
  /** Form editor for a workflow: nobody has to remember the file syntax. `initial` is a workflow object or null; `file`/`source` identify the file being edited. */
  async function openWorkflowEditor(initial, { file = null, source = null } = {}) {
    const agentList = (state.project.config && state.project.config.agents) || [];
    const agents = agentList.map((a) => a.name);
    const wf = initial ? JSON.parse(JSON.stringify(initial)) : { name: '', description: '', steps: [{ id: 'step1', task: '', agent: '', gate: 'none', needs: [], approval: null, retries: 1, allow: '' }] };
    const name = el('input', { type: 'text', value: wf.name, placeholder: 'e.g. Fix a bug with review', spellcheck: 'false' });
    const description = el('input', { type: 'text', value: wf.description || '', placeholder: 'One line: what is it for? (optional)', spellcheck: 'false' });
    const scopeSel = el('select', null, el('option', { value: 'project', text: 'This project (committed with it)' }), el('option', { value: 'ide', text: 'All my projects' }));
    scopeSel.value = source === 'ide' ? 'ide' : 'project';
    const errBox = el('div', { class: 'hint danger' });
    const stepsHost = el('div', { class: 'wf-editor' });
    const editorGraph = el('div', { class: 'wf-graph-host' });
    let timer = null;
    const modeSel = el('select', { id: 'wfe-mode', title: 'Unattended: every step runs `claude -p` (no live terminal; the process ending is the done signal)' }, el('option', { value: 'interactive', text: 'Interactive: a live terminal per step' }), el('option', { value: 'unattended', text: 'Unattended (claude -p): no live terminal, certain end' }));
    modeSel.value = wf.mode === 'unattended' ? 'unattended' : 'interactive';
    const finishSel = el('select', { id: 'wfe-finish' }, el('option', { value: 'none', text: 'Leave the runs for me to review and merge' }), el('option', { value: 'merge', text: 'Merge the runs when all steps passed and the merge guard is clean' }));
    finishSel.value = wf.finish === 'merge' ? 'merge' : 'none';
    const collect = () => ({ name: name.value, description: description.value, mode: modeSel.value, finish: finishSel.value, steps: wf.steps });
    const validate = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { const r = await api.workflow.validate(collect()); errBox.textContent = (r.errors || []).join(' ') || ''; drawWorkflowGraph(editorGraph, wf.steps); }, 250);
    };
    name.addEventListener('input', validate); description.addEventListener('input', validate);
    const nextId = () => { let i = wf.steps.length + 1; while (wf.steps.some((s) => s.id === `step${i}`)) i++; return `step${i}`; };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= wf.steps.length) return; [wf.steps[i], wf.steps[j]] = [wf.steps[j], wf.steps[i]]; draw(); };
    const draw = () => {
      stepsHost.replaceChildren(...wf.steps.map((s, i) => {
        const id = el('input', { type: 'text', value: s.id, style: 'width:110px', spellcheck: 'false', title: 'Letters, digits, - and _' });
        id.addEventListener('change', () => { const old = s.id; s.id = id.value.trim(); for (const o of wf.steps) o.needs = (o.needs || []).map((n) => (n === old ? s.id : n)); draw(); validate(); });
        const task = el('textarea', { rows: '3', spellcheck: 'false', placeholder: 'What should the agent do in this step? Use {input} for the text you type when you start the workflow.' }); task.value = s.task || '';
        task.addEventListener('input', () => { s.task = task.value; validate(); });
        const agent = el('select', { title: 'The agent or model for this step. Without one, the default chosen when the workflow starts is used.' }, el('option', { value: '', text: 'Default agent (chosen at start)' }), ...agentList.map((a) => el('option', { value: a.name, text: agentLabel(a) })), ...(s.agent && !agents.includes(s.agent) ? [el('option', { value: s.agent, text: `${s.agent} (not configured)` })] : []));
        agent.value = s.agent || ''; agent.addEventListener('change', () => { s.agent = agent.value; });
        const gate = el('select', null, ...Object.entries(WF_GATE_LABELS).map(([v, t]) => el('option', { value: v, text: t })));
        gate.value = s.gate || 'none'; gate.addEventListener('change', () => { s.gate = gate.value; validate(); });
        const appr = el('select', null, el('option', { value: '', text: 'Follow my oversight level' }), el('option', { value: 'human', text: 'Always wait for my OK' }), el('option', { value: 'none', text: 'Never wait' }));
        appr.value = s.approval || ''; appr.addEventListener('change', () => { s.approval = appr.value || null; });
        const retries = el('input', { type: 'number', min: '0', max: '3', value: String(s.retries ?? 1), style: 'width:56px' });
        retries.addEventListener('input', () => { s.retries = Math.min(3, Math.max(0, Math.round(Number(retries.value)) || 0)); validate(); });
        const limit = el('input', { type: 'number', min: '0', max: '240', value: String(s.timeout || 0), style: 'width:64px', title: '0 = no limit' });
        limit.addEventListener('input', () => { s.timeout = Math.min(240, Math.max(0, Math.round(Number(limit.value)) || 0)); validate(); });
        const others = wf.steps.slice(0, i);
        const after = others.length ? others.map((o) => { const c = el('input', { type: 'checkbox' }); c.checked = (s.needs || []).includes(o.id); c.addEventListener('change', () => { s.needs = c.checked ? [...(s.needs || []), o.id] : (s.needs || []).filter((n) => n !== o.id); validate(); }); return el('label', { class: 'check' }, c, ` ${o.id}`); }) : [el('span', { class: 'muted', text: 'This is the first step.' })];
        return el('div', { class: 'wf-edit-step' },
          el('div', { class: 'line' }, el('b', { text: `Step ${i + 1}` }), id,
            el('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0 ? '' : null, onclick: () => move(i, -1) }, ic('arrow-up')),
            el('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down', disabled: i === wf.steps.length - 1 ? '' : null, onclick: () => move(i, 1) }, ic('arrow-down')),
            el('button', { class: 'icon danger', title: 'Remove this step', 'aria-label': 'Remove step', disabled: wf.steps.length === 1 ? '' : null, onclick: () => { const gone = s.id; wf.steps.splice(i, 1); for (const o of wf.steps) o.needs = (o.needs || []).filter((n) => n !== gone); draw(); validate(); } }, ic('trash-2'))),
          el('div', { class: 'field' }, el('label', { text: 'Task' }), task),
          el('div', { class: 'line wrap' }, el('span', { text: 'Starts after:' }), ...after),
          el('div', { class: 'line wrap' }, 'Agent ', agent, ' · Check ', gate),
          el('div', { class: 'line wrap' }, 'Approval ', appr, ' · Retries after a failed check ', retries, ' · Stop after (minutes, 0 = never) ', limit));
      }));
    };
    draw(); validate();
    $('#dialog').replaceChildren(el('h3', { text: file ? 'Edit workflow' : 'New workflow' }),
      el('div', { class: 'field' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), description),
      el('div', { class: 'field' }, el('label', { text: 'How the steps run' }), modeSel, el('label', { text: 'When all steps passed' }), finishSel),
      stepsHost,
      editorGraph,
      el('div', { class: 'line' }, el('button', { onclick: () => { wf.steps.push({ id: nextId(), task: '', agent: '', gate: 'none', needs: wf.steps.length ? [wf.steps[wf.steps.length - 1].id] : [], approval: null, retries: 1, allow: '' }); draw(); validate(); } }, ic('plus'), 'Add step')),
      errBox,
      el('div', { class: 'field' }, el('label', { text: 'Save for' }), scopeSel),
      el('div', { class: 'hint', text: 'Saved as a small text file you can also edit by hand or review in a pull request. “Starts after” steps run in the same worktree when there is exactly one; steps without it run in parallel.' }),
      el('div', { class: 'actions' }, el('button', { onclick: () => openWorkflows() }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: async () => {
        const r = await api.workflow.saveFile({ scope: scopeSel.value, file: scopeSel.value === source ? file : null, workflow: collect() });
        if (r.error) { errBox.textContent = r.error; return; }
        setStatus(`Workflow saved (${r.source}).`);
        openWorkflows();
      } }, ic('check'), 'Save')));
    $('#modal').classList.remove('hidden');
  }

  /** Read-only picture of a workflow's steps and dependencies. `statusOf(id)` colours the boxes (optional). */
  async function drawWorkflowGraph(host, steps, statusOf = null) {
    const r = await api.workflow.layout(steps.map((x) => ({ id: x.id, needs: x.needs || [] })));
    if (r.error || !r.layout) { host.replaceChildren(); return; }
    const { nodes, edges, node, width, height } = r.layout;
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; };
    const svg = mk('svg', { class: 'wf-graph', viewBox: `0 0 ${Math.max(width, 40)} ${Math.max(height, 20)}`, width: Math.max(width, 40), height: Math.max(height, 20), role: 'img', 'aria-label': `Workflow with ${nodes.length} steps` });
    const pos = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const a = pos.get(e.from); const b = pos.get(e.to);
      const x1 = a.x + node.w; const y1 = a.y + node.h / 2; const x2 = b.x; const y2 = b.y + node.h / 2; const mx = (x1 + x2) / 2;
      svg.append(mk('path', { class: 'wf-g-edge', d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 3},${y2}` }));
      svg.append(mk('path', { class: 'wf-g-arrow', d: `M${x2 - 7},${y2 - 4} L${x2},${y2} L${x2 - 7},${y2 + 4} Z` }));
    }
    for (const n of nodes) {
      const status = statusOf ? statusOf(n.id) : 'waiting';
      const label = n.id.length > 15 ? `${n.id.slice(0, 14)}…` : n.id;
      const g = mk('g', { class: `wf-g-node wf-g-${status}` });
      g.append(mk('title', {}, `${n.id}${statusOf ? `: ${WF_LABEL[status] || status}` : ''}`));
      g.append(mk('rect', { x: n.x, y: n.y, width: node.w, height: node.h, rx: 6 }));
      g.append(mk('text', { x: n.x + node.w / 2, y: n.y + node.h / 2 + 4, 'text-anchor': 'middle' }, label));
      svg.append(g);
    }
    host.replaceChildren(svg);
  }

  /** Runs a throw-away two-step workflow with one agent and shows, live, which parts of the machinery work on this machine. */
  async function openWorkflowSelfCheck() {
    if (!state.project || !state.project.isRepo) { setStatus('The workflow self-check needs a git repository.'); return; }
    const close = () => $('#modal').classList.add('hidden');
    const agents = (state.project.config && state.project.config.agents) || [];
    if (!agents.length) { setStatus('No agent is configured.'); return; }
    const pick = el('select', { id: 'wfs-agent' }, ...agents.map((a) => el('option', { value: a.name, text: agentLabel(a) })));
    pick.value = agents.some((a) => a.name === lastAgentName()) ? lastAgentName() : agents[0].name;
    const body = el('div', { class: 'wfs-items' });
    const adviceBox = el('div', { class: 'hint' });
    let st = null; let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const ICON = { ok: '✓', warn: '!', fail: '✗', wait: '…' };
    const draw = async () => {
      if (!st) return;
      const r = await api.workflow.selfcheck(st);
      if (!r || !r.verdict) return;
      const v = r.verdict;
      body.replaceChildren(...v.items.map((i) => el('div', { class: `wfs-item wfs-${i.state}` }, el('span', { class: 'wfs-mark', text: ICON[i.state] }), el('span', { text: i.label }), i.detail ? el('span', { class: 'muted', text: ` · ${i.detail}` }) : null)));
      adviceBox.replaceChildren(...v.advice.map((t) => el('div', { text: t })));
      adviceBox.classList.toggle('danger', v.done && !v.ok);
      if (v.done) { stop(); cleanBtn.disabled = false; startBtn.disabled = false; startBtn.replaceChildren(ic('refresh-cw'), 'Run again'); }
    };
    const startBtn = el('button', { class: 'primary', id: 'wfs-start', onclick: async () => {
      startBtn.disabled = true; cleanBtn.disabled = true;
      rememberAgent(pick.value);
      const def = await api.workflow.selfcheck();
      st = null; body.replaceChildren(el('div', { class: 'muted', text: 'Starting…' }));
      await wfStartNew({ name: def.workflow.name, source: 'built-in', workflow: def.workflow }, '', { default: pick.value, steps: {} }, { mode: 'interactive', finish: 'none' });
      st = [...state.workflows.values()].filter((x) => x.name === def.workflow.name).pop();
      stop(); timer = setInterval(() => { if (!document.body.contains(body)) { stop(); return; } draw().catch(() => {}); }, 1000);
      await draw();
    } }, ic('play'), 'Run the self-check');
    const cleanBtn = el('button', { id: 'wfs-clean', title: 'Forget the self-check workflow and discard its throw-away run', disabled: '', onclick: async () => {
      if (!st) return;
      const ids = [...new Set(Object.values(st.steps).map((x) => x.runId).filter(Boolean))];
      for (const t of state.terms.values()) if (t.wf && t.wf.wfId === st.id && t.id !== null && !t.exited) api.pty.kill(t.id);
      for (const id of ids) { try { await api.runs.discard(id, 'skip'); } catch { /* already gone */ } }
      state.workflows.delete(st.id); await api.workflow.remove(st.id); st = null; renderWorkflows(); await refreshRuns();
      body.replaceChildren(el('div', { class: 'muted', text: 'Cleaned up.' })); adviceBox.replaceChildren(); cleanBtn.disabled = true;
    } }, ic('trash-2'), 'Clean up');
    $('#dialog').replaceChildren(el('h3', { text: 'Workflow self-check' }),
      el('div', { class: 'hint', text: 'Runs a throw-away workflow with one agent: step 1 writes a small file, step 2 reads it. It shows whether Bazinga is told that an agent finished, whether the check runs, and whether step 2 starts by itself. Takes about a minute on a local model.' }),
      el('div', { class: 'field' }, el('label', { text: 'Agent / model' }), pick), body, adviceBox,
      el('div', { class: 'actions' }, el('button', { onclick: () => { stop(); close(); } }, ic('x'), 'Close'), cleanBtn, startBtn));
    $('#modal').classList.remove('hidden');
  }

  async function openWorkflows(arg) {
    const preset = arg && typeof arg.input === 'string' ? arg : {};
    if (!state.project || !state.project.isRepo) { setStatus('Workflows need a git repository.'); return; }
    const close = () => $('#modal').classList.add('hidden');
    const res = await api.workflow.list();
    if (res.error) { setStatus(res.error); return; }
    const valid = res.workflows.filter((w) => w.workflow);
    const sel = el('select', null, ...valid.map((w, i) => el('option', { value: String(i), text: `${w.name} (${w.source})` })));
    const desc = el('div', { class: 'hint' });
    const input = el('textarea', { rows: '4', placeholder: 'What is this workflow for? It replaces {input} in the steps (for example the bug description).', spellcheck: 'false' });
    const needHint = el('div', { class: 'hint danger' });
    input.addEventListener('input', () => { input.classList.remove('invalid'); needHint.textContent = ''; });
    const stepsView = el('div', { class: 'wf-preview' });
    const graphHost = el('div', { class: 'wf-graph-host' });
    const allAgents = (state.project.config && state.project.config.agents) || [];
    const agentOptions = (first) => [...(first ? [el('option', { value: '', text: first })] : []), ...allAgents.map((a) => el('option', { value: a.name, text: agentLabel(a) }))];
    const defaultAgent = el('select', { id: 'wf-default-agent', title: 'Used for every step that has no agent of its own' }, ...agentOptions(''));
    defaultAgent.value = allAgents.some((a) => a.name === lastAgentName()) ? lastAgentName() : (allAgents[0] ? allAgents[0].name : '');
    let stepAgents = {};
    const postBack = el('input', { type: 'checkbox', id: 'wf-comment' });
    const unattended = el('input', { type: 'checkbox', id: 'wf-unattended' });
    const finishMerge = el('input', { type: 'checkbox', id: 'wf-finish' });
    const refresh = () => {
      const w = valid[Number(sel.value)];
      if (!w) return;
      unattended.checked = w.workflow.mode === 'unattended'; finishMerge.checked = w.workflow.finish === 'merge';
      desc.textContent = w.description || '';
      drawWorkflowGraph(graphHost, w.workflow.steps);
      stepAgents = {};
      stepsView.replaceChildren(...w.workflow.steps.map((s, i) => {
        const pick = el('select', { class: 'wf-step-agent', 'data-step': s.id, title: 'The agent or model for this step' }, ...agentOptions('Default agent'));
        pick.value = allAgents.some((a) => a.name === s.agent) ? s.agent : '';
        const note = () => { if (pick.value) stepAgents[s.id] = pick.value; else delete stepAgents[s.id]; };
        pick.addEventListener('change', note); note();
        const task = String(s.task || '').replace(/\s+/g, ' ').trim();
        const approval = s.approval === 'human' ? 'you approve before the next step' : s.approval === 'none' ? 'no approval needed' : 'approval follows your oversight level';
        return el('div', { class: 'wf-start-step' },
          el('div', { class: 'line wrap' }, el('b', { text: `${i + 1}. ${s.id}` }), el('span', { class: 'muted', text: s.needs.length ? `after ${s.needs.join(', ')}` : 'starts first' }), el('span', { class: 'spacer' }), pick),
          el('div', { class: 'wf-task', title: s.task, text: (task.length > 170 ? `${task.slice(0, 170)}…` : task).split('{input}').join('‹your input›') }),
          el('div', { class: 'muted', text: `Check: ${WF_GATE_LABELS[s.gate] || s.gate} · ${approval}` }));
      }));
    };
    if (preset.workflow && valid.some((w) => `${w.source}:${w.name}` === preset.workflow)) sel.value = String(valid.findIndex((w) => `${w.source}:${w.name}` === preset.workflow));
    input.value = preset.input || '';
    sel.addEventListener('change', refresh); refresh();
    const bad = res.workflows.filter((w) => w.errors && w.errors.length);
    $('#dialog').replaceChildren(el('h3', { text: 'Start a workflow' }),
      valid.length ? el('div', { class: 'field' }, el('label', { text: 'Workflow' }), sel, desc, graphHost) : el('div', { class: 'empty', text: 'No valid workflows.' }),
      valid.length ? el('div', { class: 'field' }, el('label', { text: 'Default agent / model' }), defaultAgent, el('div', { class: 'hint', text: 'Every step without its own choice below uses this one (it starts as the agent you used last).' })) : null,
      valid.length ? el('div', { class: 'field' }, el('label', { text: 'The steps, and the agent / model for each' }), stepsView) : null,
      valid.length ? el('div', { class: 'field' },
        el('label', { class: 'check', title: 'Every step runs claude -p and ends by itself, so Bazinga knows for certain that it is done. You cannot watch or answer questions; file edits are accepted, shell commands only if the agent button allows them.' }, unattended, ' Run the steps unattended (claude -p: no live terminal, a certain end)'),
        preset.workItem ? el('label', { class: 'check', title: 'When the workflow has finished, a comment with the result is added to the work item. Nothing else on the item is changed.' }, postBack, ` Post the result as a comment on ${preset.workItem.ref || preset.workItem.id}`) : null,
        el('label', { class: 'check', title: 'After the last step passed, every run of the workflow is merged into your branch, but only while the merge guard has no blockers and no warnings. Otherwise nothing is merged and you are told why.' }, finishMerge, ' Merge the result when all steps passed and the merge guard is clean')) : null,
      el('div', { class: 'field' }, el('label', { text: 'Input' }), input, needHint,
        el('div', { class: 'line' }, el('button', { id: 'wf-pull', title: 'Azure Boards or Jira: fill the input from a story or bug', onclick: () => { const w = valid[Number(sel.value)]; openWorkItems((text, item) => openWorkflows({ input: text, workItem: { provider: item.provider, id: item.id, ref: item.ref }, workflow: w ? `${w.source}:${w.name}` : '' }), () => openWorkflows({ input: input.value, workItem: preset.workItem, workflow: w ? `${w.source}:${w.name}` : '' })); } }, ic('external-link'), 'Pull in a work item…'))),
      ...bad.map((w) => el('div', { class: 'hint danger', text: w.errors.join(' ') })),
      el('div', { class: 'hint', text: 'Each step is an agent run in its own worktree; a step that depends on exactly one other continues in that worktree. A step starts when the steps it needs have passed their gates (and your approval, if asked). Use “New workflow…” to build your own with a form.' }),
      el('div', { class: 'line wrap' },
        el('button', { onclick: () => openWorkflowEditor(null) }, ic('plus'), 'New workflow…'),
        el('button', { id: 'wf-selfcheck', title: 'Run a throw-away two-step workflow and see whether the chaining works with your agent', onclick: openWorkflowSelfCheck }, ic('flask-conical'), 'Self-check…'),
        valid.length ? el('button', { title: 'Built-in workflows open as a copy', onclick: () => { const w = valid[Number(sel.value)]; if (!w) return; openWorkflowEditor(w.source === 'built-in' ? { ...w.workflow, name: `${w.workflow.name} (copy)` } : w.workflow, w.source === 'built-in' ? {} : { file: w.file, source: w.source }); } }, ic('copy'), 'Edit / copy…') : null,
        valid.length ? el('button', { class: 'danger', onclick: async () => { const w = valid[Number(sel.value)]; if (!w || w.source === 'built-in') { setStatus('Built-in workflows cannot be deleted.'); return; } if (!window.confirm(`Delete the workflow “${w.name}”?`)) return; await api.workflow.deleteFile({ source: w.source, file: w.file }); openWorkflows(); } }, ic('trash-2'), 'Delete') : null),
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), el('button', { class: 'primary', onclick: async () => {
        const w = valid[Number(sel.value)]; if (!w) return;
        if (workflowNeedsInput(w.workflow, input.value)) { input.focus(); input.classList.add('invalid'); needHint.textContent = 'This workflow needs an input: its steps use it as the text of the task (for example the bug, or what to refactor).'; return; }
        close();
        rememberAgent(defaultAgent.value);
        await wfStartNew({ name: w.name, source: w.source, workflow: w.workflow }, input.value, { default: defaultAgent.value, steps: { ...stepAgents } }, { mode: unattended.checked ? 'unattended' : 'interactive', finish: finishMerge.checked ? 'merge' : 'none', workItem: preset.workItem && postBack.checked ? preset.workItem : null });
      } }, ic('play'), 'Start')));
    $('#modal').classList.remove('hidden');
  }

  async function openJournal(run) {
    const close = () => $('#modal').classList.add('hidden');
    const res = await api.runs.journal(run.id);
    const body = res.error ? res.error : (res.text || 'Nothing recorded yet.');
    $('#dialog').replaceChildren(el('h3', { text: `Journal · ${run.name}` }),
      el('pre', { class: 'journal', text: body }),
      el('div', { class: 'hint', text: 'Kept inside the repository’s .git folder, so it survives merging or discarding the run.' }),
      el('div', { class: 'actions' }, el('button', { onclick: () => api.copy(body) }, ic('clipboard-copy'), 'Copy'), el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }

  // session replay: scrub through a run's journal + (while still intact) its commits, step by step
  async function openReplay(run) {
    // the inline diff preview below is a dialog-scoped Monaco diff editor (not the shared one at $('#diff')), so it
    // needs its own disposal - on every step/file change and when the dialog closes - or its models leak.
    let inlineDiff = null;
    const disposeInlineDiff = () => { if (inlineDiff) { inlineDiff.editor.dispose(); inlineDiff.originalModel.dispose(); inlineDiff.modifiedModel.dispose(); inlineDiff = null; } };
    const close = () => { disposeInlineDiff(); $('#modal').classList.add('hidden'); };
    const res = await api.runs.replay(run.id);
    if (res.error) { setStatus(res.error); return; }
    const steps = res.steps || [];
    let selected = steps.length - 1;
    const list = el('div', { class: 'replay-list' });
    const detail = el('div', { class: 'replay-detail' });
    const scrubber = el('input', { type: 'range', min: '0', max: String(Math.max(0, steps.length - 1)), step: '1', value: String(Math.max(0, selected)) });
    const prevBtn = el('button', { class: 'icon', title: 'Previous step' }, ic('skip-back'));
    const nextBtn = el('button', { class: 'icon', title: 'Next step' }, ic('skip-forward'));
    // small side-by-side preview right in the panel, instead of a click-through to a separate editor tab
    const showInlineDiff = async (host, fileRows, row, sha, f) => {
      disposeInlineDiff();
      for (const r of fileRows) r.classList.remove('sel');
      row.classList.add('sel');
      const diffHost = el('div', { class: 'replay-diff' });
      fill(host, el('div', { class: 'line wrap' }, el('span', { class: 'muted small', text: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path }),
        el('button', { class: 'icon', title: 'Open in the editor', onclick: () => openCommitDiff(sha, f) }, ic('external-link'))), diffHost);
      const info = await api.history.diff(sha, f.path, f.oldPath);
      if (!diffHost.isConnected) return; // a later click (or the dialog closing) already moved on
      if (info.error) { fill(diffHost, el('div', { class: 'hint bad', text: info.error })); return; }
      const uri = (scheme) => monaco.Uri.from({ scheme, path: `/replay/${sha}/${f.path}` });
      const originalModel = monaco.editor.createModel(info.diff.original, undefined, uri('replay-a'));
      const modifiedModel = monaco.editor.createModel(info.diff.modified, undefined, uri('replay-b'));
      const editor = monaco.editor.createDiffEditor(diffHost, { theme: MONACO_THEMES[resolvedTheme()], fontSize: 13, fontFamily: MONO, minimap: { enabled: false }, scrollBeyondLastLine: false, renderSideBySide: true, originalEditable: false, readOnly: true });
      editor.setModel({ original: originalModel, modified: modifiedModel });
      inlineDiff = { editor, originalModel, modifiedModel };
    };
    const renderStep = async () => {
      disposeInlineDiff();
      for (const row of list.children) row.classList.remove('sel');
      const row = list.children[selected];
      if (row) { row.classList.add('sel'); row.scrollIntoView({ block: 'nearest' }); }
      prevBtn.disabled = selected <= 0; nextBtn.disabled = selected >= steps.length - 1;
      const s = steps[selected];
      if (!s) { fill(detail, el('div', { class: 'empty', text: 'Nothing recorded yet.' })); return; }
      if (s.type === 'event') {
        // a commit folded into staged changes before review - see runs.prepareReview(). The commit itself is gone
        // (squashed into uncommitted changes), so there is no file list to show any more, just that it happened.
        if (s.kind === 'commit-snapshot') {
          fill(detail, el('div', { class: 'hint', text: `${new Date(s.t).toLocaleTimeString()} · folded into staged changes before merge - no per-file diff any more` }), el('pre', { class: 'c-msg', text: s.text || '' }));
          return;
        }
        fill(detail, el('div', { class: 'hint', text: `${new Date(s.t).toLocaleTimeString()} · ${s.kind}` }), el('div', { text: s.text || '(no detail)' }));
        return;
      }
      fill(detail, el('div', { class: 'hint', text: 'Loading…' }));
      const info = await api.history.info(s.sha);
      if (selected !== steps.indexOf(s)) return;
      if (info.error) { fill(detail, el('div', { class: 'hint bad', text: info.error })); return; }
      const diffBox = el('div');
      const fileRows = info.info.files.map((f) => {
        const row2 = el('div', { class: 'row file', title: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path },
          el('span', { class: `tag st-${f.status === 'R' ? 'M' : f.status}`, text: f.status }), el('span', { class: 'name', text: f.path }));
        row2.addEventListener('click', () => showInlineDiff(diffBox, fileRows, row2, s.sha, f));
        return row2;
      });
      fill(detail, el('div', { class: 'hint', text: `${new Date(s.t).toLocaleTimeString()} · commit ${s.sha.slice(0, 7)}` }), el('pre', { class: 'c-msg', text: info.info.message }),
        ...fileRows, diffBox);
    };
    steps.forEach((s, i) => {
      const isCommitLike = s.type === 'commit' || s.kind === 'commit-snapshot';
      const label = s.type === 'commit' ? `commit ${s.sha.slice(0, 7)}: ${s.subject}` : s.kind === 'commit-snapshot' ? `commit ${s.text}` : `${s.kind}${s.text ? `: ${s.text}` : ''}`;
      list.appendChild(el('div', { class: `row replay-step ${s.type}`, title: new Date(s.t).toLocaleString(), onclick: () => { selected = i; scrubber.value = String(i); renderStep(); } },
        ic(isCommitLike ? 'git-commit-horizontal' : 'history'), el('span', { class: 'name', text: label }), el('span', { class: 'muted small', text: ago(s.t / 1000) })));
    });
    const step = (d) => { const n = selected + d; if (n < 0 || n > steps.length - 1) return; selected = n; scrubber.value = String(selected); renderStep(); };
    scrubber.addEventListener('input', () => { selected = Number(scrubber.value); renderStep(); });
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    const body = el('div', { class: 'replay-body' }, list, detail);
    const wrap = el('div', null, el('div', { class: 'line' }, prevBtn, scrubber, nextBtn), body);
    // keyboard stepping (←/→, j/k) alongside the buttons; scoped to this dialog's own nodes, so it is gone once replay closes
    wrap.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || k === 'k') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight' || k === 'j') { e.preventDefault(); step(1); }
    });
    $('#dialog').replaceChildren(el('h3', { text: `Replay · ${run.name}` }),
      steps.length ? wrap : el('div', { class: 'empty', text: 'Nothing recorded for this run yet.' }),
      el('div', { class: 'hint', text: 'Built from the run’s journal and the commits it made before review folded them into staged changes (opening Merge or the guard does that fold, after which newer commits stop showing here).' }),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
    if (steps.length) await renderStep();
  }

  async function openCompare(preselect) {
    const list = (state.runs && state.runs.runs) || [];
    const close = () => $('#modal').classList.add('hidden');
    if (list.length < 2) { setStatus('You need at least two agent runs to compare.'); return; }
    const opts = () => list.map((r) => el('option', { value: r.id, text: `${r.name}${r.agent ? ` · ${r.agent}` : ''}` }));
    const selA = el('select', null, ...opts()); const selB = el('select', null, ...opts());
    selA.value = (preselect && preselect.a) || list[1].id; selB.value = (preselect && preselect.b) || list[0].id;
    if (selA.value === selB.value) selB.value = list.find((r) => r.id !== selA.value).id;
    const gates = el('input', { type: 'checkbox' }); gates.checked = true;
    const out = el('div', { class: 'cmp' });
    const go = async () => {
      fill(out, el('div', { class: 'muted', text: 'Comparing…' }));
      const res = await api.runs.compare({ a: selA.value, b: selB.value, gates: gates.checked });
      if (res.error) { fill(out, el('div', { class: 'hint danger', text: res.error })); return; }
      renderComparison(out, res.comparison);
    };
    $('#dialog').replaceChildren(el('h3', { text: 'Compare agent runs' }),
      el('div', { class: 'line wrap' }, selA, ' vs ', selB),
      el('label', { class: 'check' }, gates, ' Also run the gates on both (slower)'),
      out,
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Close'), el('button', { class: 'primary', onclick: go }, ic('git-compare'), 'Compare')));
    $('#modal').classList.remove('hidden');
    go();
  }

  function renderComparison(host, c) {
    const gateText = (g) => (!g ? '' : g.error ? 'gates not run' : `${g.errors} error${g.errors === 1 ? '' : 's'}, ${g.warnings} warning${g.warnings === 1 ? '' : 's'}`);
    const col = (s) => el('div', { class: 'cmp-col' }, el('b', { text: s.name }), el('div', { class: 'muted', text: s.agent || 'agent' }),
      el('div', { text: `${s.files} file${s.files === 1 ? '' : 's'} · +${s.added} −${s.removed}` }),
      s.gates ? el('div', { class: s.gates.errors ? 'danger' : '', text: gateText(s.gates) }) : null,
      s.statsText ? el('div', { class: 'muted small', text: s.statsText }) : null);
    const group = (title, items) => (items.length ? el('div', { class: 'cmp-group' }, el('div', { class: 'agent-head', text: `${title} (${items.length})` }), ...items) : null);
    const row = (text, cls) => el('div', { class: `cmp-file ${cls || ''}`, text });
    fill(host,
      el('div', { class: 'cmp-cols' }, col(c.a), col(c.b)),
      c.identical ? el('div', { class: 'hint', text: 'Both runs produced exactly the same files and content.' }) : null,
      group('Changed by both, different content', c.both.filter((f) => !f.same).map((f) => row(`${f.path}   (+${f.a.added} −${f.a.removed} | +${f.b.added} −${f.b.removed})`))),
      group('Changed by both, same content', c.both.filter((f) => f.same).map((f) => row(f.path, 'muted'))),
      group(`Only in ${c.a.name}`, c.onlyA.map((p) => row(p))),
      group(`Only in ${c.b.name}`, c.onlyB.map((p) => row(p))),
      el('div', { class: 'hint', text: 'Review either run to see its diff. Merge the better one and discard the other.' }));
  }

  async function openSpringOverview() {
    const close = () => $('#modal').classList.add('hidden');
    $('#dialog').replaceChildren(el('h3', { text: 'Spring: endpoints and beans' }), el('div', { class: 'muted', text: 'Scanning…' }));
    $('#modal').classList.remove('hidden');
    const res = await api.springMap.overview();
    if (res.error) { $('#dialog').replaceChildren(el('h3', { text: 'Spring' }), el('div', { class: 'hint danger', text: res.error }), el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Close'))); return; }
    const filter = el('input', { type: 'text', placeholder: 'Filter (path, method, class, file)…', spellcheck: 'false' });
    const list = el('div', { class: 'lh-list spring-ov' });
    const rows = [
      ...res.endpoints.map((e) => ({ kind: 'endpoint', head: `${e.method} ${e.path}`, sub: `${e.handler} · ${e.file}:${e.line}`, file: e.file, line: e.line })),
      ...res.beans.map((b) => ({ kind: 'bean', head: `@Bean ${b.name}`, sub: `${b.type} · ${b.file}:${b.line}`, file: b.file, line: b.line })),
      ...res.components.map((c) => ({ kind: 'component', head: `@${c.stereotype} ${c.name}`, sub: `${c.file}:${c.line}`, file: c.file, line: c.line })),
    ];
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = rows.filter((r) => !q || `${r.head} ${r.sub}`.toLowerCase().includes(q));
      fill(list, shown.length ? shown.map((r) => el('div', { class: 'lh-row', title: r.sub, onclick: () => { close(); openFile(r.file, r.line); } },
        el('span', { class: 'chip', text: r.kind }), el('span', { class: 'lh-label' }, el('b', { text: r.head }), el('span', { class: 'muted', text: `  ${r.sub}` })))) : el('div', { class: 'empty', text: rows.length ? 'Nothing matches.' : 'No Spring endpoints or beans found in .java / .kt files.' }));
    };
    filter.addEventListener('input', render);
    $('#dialog').replaceChildren(el('h3', { text: 'Spring: endpoints and beans' }), filter, list,
      el('div', { class: 'hint', text: `${res.endpoints.length} endpoints · ${res.beans.length} @Bean methods · ${res.components.length} stereotype classes. Found by pattern from the annotations, not from a running application.` }),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    render();
    filter.focus();
  }

  // a small “?” next to a heading: hover for the short version, click to keep it open
  function helpQ(text) {
    const q = el('span', { class: 'help-q', tabindex: '0', role: 'button', title: text, 'aria-label': `Help: ${text}`, text: '?' });
    const toggle = () => {
      const host = q.closest('.field') || q.parentElement; const old = host.querySelector(':scope > .help-text');
      if (old) { old.remove(); return; }
      const t = el('div', { class: 'help-text', text }); const head = q.closest('.agent-head') || q.parentElement; head.after(t);
    };
    q.addEventListener('click', toggle); q.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return q;
  }
  const headWithHelp = (text, help) => el('div', { class: 'agent-head' }, text, helpQ(help));

  // ---------------------------------------------------------------- test coverage in the gutter (lcov / JaCoCo / Cobertura files that a test run left in the project)
  async function paintCoverage() {
    if (!editor) return;
    if (!coverage.deco) coverage.deco = editor.createDecorationsCollection([]);
    const tab = activeTab();
    if (!coverage.on || !tab || tab.kind !== 'file') { coverage.deco.set([]); return; }
    const res = await api.insights.coverage(tab.rel);
    if (res.error || res.none) { coverage.deco.set([]); coverage.note = res.error || 'No coverage file found (lcov.info, jacoco.xml or coverage.xml). Run the tests with coverage on first.'; setStatus(coverage.note); return; }
    const one = (n, cls) => ({ range: new monaco.Range(n, 1, n, 1), options: { isWholeLine: false, linesDecorationsClassName: cls } });
    coverage.deco.set([...res.covered.map((n) => one(n, 'cov-hit')), ...res.missed.map((n) => one(n, 'cov-miss'))]);
    setStatus(res.pct === null ? `Coverage: ${tab.rel} is not in ${res.file}.` : `Coverage of ${tab.rel}: ${res.pct}% of the lines (from ${res.file}, ${ago(Math.floor(res.at / 1000))}).`);
  }
  function toggleCoverage() { coverage.on = !coverage.on; if (!coverage.on) setStatus('Coverage marks hidden.'); paintCoverage(); }

  // ---------------------------------------------------------------- While you were away + undo a merged run
  async function openAway({ auto = false } = {}) {
    const close = async () => { $('#modal').classList.add('hidden'); try { await api.away.seen(); } catch { /* ignore */ } };
    const s = await api.away.get();
    if (s.error) { if (!auto) setStatus(s.error); return; }
    if (auto && s.empty) { await api.away.seen(); return; }
    if (auto && !$('#modal').classList.contains('hidden')) return; // another dialog is open: do not take it over
    const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const group = (title, items, cls, act) => (items.length ? el('div', { class: 'ins-sec' }, el('b', { text: `${title} (${items.length})` }),
      ...items.map((i) => el('div', { class: `ins-line ${cls}` }, `${i.name}  ·  ${when(i.at)}${i.why ? `  ·  ${i.why}` : ''}${i.files ? `  ·  ${i.files} file${i.files === 1 ? '' : 's'}` : ''}  `, act && i.live ? el('button', { onclick: async () => { await close(); const r = ((state.runs && state.runs.runs) || []).find((x) => x.id === i.id); if (r) act.run(r); } }, ic('eye'), act.label) : ''))) : '');
    $('#dialog').replaceChildren(el('h3', { text: 'While you were away' }), el('div', { class: 'hint', id: 'away-headline', text: s.headline }),
      el('div', { class: 'ins-list' },
        group('Need you', s.groups.needsYou, 'danger', { label: 'Review', run: reviewRun }),
        group('Ready to review', s.groups.ready, '', { label: 'Review', run: reviewRun }),
        group('Merged', s.groups.merged, 'muted', null),
        group('Thrown away', s.groups.discarded, 'muted', null)),
      el('div', { class: 'actions' }, el('button', { onclick: async () => { await close(); openUndo(); } }, ic('undo-2'), 'Undo a merged run…'), el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }

  async function openUndo() {
    const close = () => $('#modal').classList.add('hidden');
    const r = await api.away.merged();
    if (r.error) { setStatus(r.error); return; }
    const rows = r.merged.map((m) => el('div', { class: 'ins-line' }, `${m.name}  ·  merged ${new Date(m.at).toLocaleString()} into ${m.into}  `,
      el('button', { class: 'danger', onclick: async (ev) => {
        if (!window.confirm(`Undo “${m.name}”?\n\nBazinga adds a new commit that reverses it. Nothing is deleted and you can reverse the undo again with git.`)) return;
        ev.currentTarget.disabled = true;
        const res = await api.away.undo(m.commit);
        if (res.error) { window.alert(res.error); ev.currentTarget.disabled = false; return; }
        setStatus(`Undone: ${res.undone}.`); close(); await refreshRuns();
      } }, ic('undo-2'), 'Undo')));
    $('#dialog').replaceChildren(el('h3', { text: 'Undo a merged run' }),
      r.merged.length ? el('div', { class: 'ins-list' }, ...rows) : el('div', { class: 'hint', text: 'No merged runs to undo. Only merges made with Bazinga are listed, and only while they are still part of this branch.' }),
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- What's new (the changelog that ships with the app; shown once per change)
  async function openWhatsNew() {
    const c = await api.changelog.get();
    const close = () => $('#modal').classList.add('hidden');
    if (c.error || !c.text) { setStatus(c.error || 'No changelog found.'); return; }
    const first = c.text.split('\n').slice(0, 40).join('\n');
    const body = markdownToNode(first);
    body.classList.add('whatsnew');
    $('#dialog').replaceChildren(el('h3', { text: `What’s new in Bazinga${c.version ? ` ${c.version}` : ''}` }), body,
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: async () => { await api.changelog.seen(c.hash); close(); } }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
    await api.changelog.seen(c.hash);
  }

  // ---------------------------------------------------------------- Usage & insights: facts other tools already produce, one window, nothing shown that could not be read
  async function openInsights() {
    const close = () => $('#modal').classList.add('hidden');
    $('#dialog').replaceChildren(el('h3', { text: 'Usage & insights' }), el('div', { class: 'muted', text: 'Looking…' }));
    $('#modal').classList.remove('hidden');
    const d = await api.insights.get();
    if (d.error) { $('#dialog').replaceChildren(el('h3', { text: 'Usage & insights' }), el('div', { class: 'hint danger', text: d.error }), el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close'))); return; }
    const cur = (state.project && state.project.config && state.project.config.insights) || {};
    const sec = (title, ...kids) => el('div', { class: 'ins-sec', 'data-ins': title }, el('b', { text: title }), ...kids);
    const line = (text, cls = '') => el('div', { class: `ins-line ${cls}`, text });
    const money = (v) => (v > 0 ? `$${v.toFixed(2)}` : '$0');
    const out = [];
    // Claude plan limits
    if (!d.limitsOn) out.push(sec('Claude plan limits', line('Off. Turning it on lets Claude Code sessions that Bazinga starts report how much of your 5-hour and 7-day allowance is used. Note: it replaces your own Claude Code status line in those sessions.', 'muted'), el('button', { onclick: async () => { await saveSetting({ insights: { ...cur, claudeLimits: true } }); openInsights(); } }, ic('check'), 'Turn on')));
    else if (!d.limits) out.push(sec('Claude plan limits', line('Waiting for the first answer of a Claude Code session started from Bazinga after this was switched on. If nothing appears after a few messages, your plan or version does not report limits (API-key use never does).', 'muted'), el('button', { onclick: async () => { await saveSetting({ insights: { ...cur, claudeLimits: false } }); openInsights(); } }, ic('x'), 'Turn off')));
    else out.push(sec('Claude plan limits', ...d.limits.lines.map((t) => line(t, d.limits.warn ? 'warn' : '')), d.limits.stale ? line('These numbers are old (no Claude Code session reported for a while).', 'muted') : '', el('button', { onclick: async () => { await saveSetting({ insights: { ...cur, claudeLimits: false } }); openInsights(); } }, ic('x'), 'Turn off')));
    // totals
    const t = d.totals;
    if (t.month.runs) out.push(sec('Agent runs: tokens and cost', ...[['Today', t.today], ['Last 7 days', t.week], ['Last 30 days', t.month]].map(([n, x]) => line(`${n}: ${x.runs} run${x.runs === 1 ? '' : 's'}, ${(x.tokens / 1000).toFixed(0)}k tokens, ${money(x.costUsd)}${x.localRuns ? ` (${x.localRuns} local, free)` : ''}${x.unknownCost ? ` · ${x.unknownCost} with unknown cost` : ''}`)), line('Counted from finished runs (merged or discarded), the same numbers as the scorecard.', 'muted')));
    if (d.time.length) out.push(sec('Agent working time by kind of task (30 days)', ...d.time.slice(0, 6).map((k) => line(`${k.kind}: ${k.runs} run${k.runs === 1 ? '' : 's'}, ${fmtMs(k.avgMs)} each on average, ${fmtMs(k.ms)} in total`))));
    // local models
    if (d.models) out.push(sec('Local models in memory', ...(d.models.length ? d.models.map((m) => line(`${m.name}: ${m.text}`, m.verdict === 'ok' ? '' : m.verdict === 'bad' ? 'danger' : 'warn')) : [line('Ollama is running, but no model is loaded right now.', 'muted')])));
    // on demand
    const slot = (name, label, run, extra = []) => {
      const box = el('div', { class: 'ins-out' });
      return sec(name, ...extra, el('button', { onclick: async (ev) => { ev.currentTarget.disabled = true; box.replaceChildren(line('Checking…', 'muted')); const r = await run(); box.replaceChildren(...r); ev.currentTarget.disabled = false; } }, ic('refresh-cw'), label), box);
    };
    const sonarKey = el('input', { type: 'text', value: d.sonarProject, placeholder: 'SonarCloud project key (org_project)', style: 'width:100%' });
    out.push(slot('Dependency problems', 'Check now', async () => {
      const r = await api.insights.run('deps');
      if (r.error) return [line(r.error, 'danger')];
      const rows = [r.npm && line(`npm: ${r.npm.text}`, r.npm.total ? 'warn' : ''), r.dependabot && line(`Dependabot: ${r.dependabot.text}`, r.dependabot.total ? 'warn' : '')];
      if (r.maven) {
        const names = r.maven.deps.map((dep) => `${dep.name}:${dep.version || '?'}`);
        rows.push(line(`Maven dependencies (pom.xml): ${names.length} found`));
        if (names.length) rows.push(line(names.slice(0, 8).join(', ') + (names.length > 8 ? `, … (+${names.length - 8} more)` : ''), 'muted'));
        if (r.maven.vulns) rows.push(line(r.maven.vulns.text, r.maven.vulns.total ? 'warn' : ''));
        else if (r.maven.vulnsError) rows.push(line(r.maven.vulnsError, 'muted'));
      }
      if (r.gradle) {
        const names = r.gradle.deps.map((dep) => `${dep.name}:${dep.version || '?'}`);
        rows.push(line(`Gradle dependencies (build.gradle): ${names.length} found`));
        if (names.length) rows.push(line(names.slice(0, 8).join(', ') + (names.length > 8 ? `, … (+${names.length - 8} more)` : ''), 'muted'));
        if (r.gradle.vulns) rows.push(line(r.gradle.vulns.text, r.gradle.vulns.total ? 'warn' : ''));
        else if (r.gradle.vulnsError) rows.push(line(r.gradle.vulnsError, 'muted'));
      }
      if (r.note) rows.push(line(r.note, 'muted'));
      const out2 = rows.filter(Boolean);
      return out2.length ? out2 : [line('Nothing to check here (no package.json, no pom.xml or build.gradle, and no GitHub project with Dependabot).', 'muted')];
    }));
    out.push(slot('Code quality (SonarCloud)', 'Check this branch', async () => {
      const r = await api.insights.run('sonar', sonarKey.value.trim());
      if (r.error) return [line(r.error, 'danger')];
      if (sonarKey.value.trim() !== (cur.sonarProject || '')) await saveSetting({ insights: { ...cur, sonarProject: sonarKey.value.trim() } });
      return [line(r.gate.text, r.gate.ok === false ? 'danger' : ''), r.branch ? line(`Branch: ${r.branch}`, 'muted') : ''].filter(Boolean);
    }, [sonarKey]));
    out.push(slot('Running Spring app (Actuator)', 'Check', async () => {
      const r = await api.insights.run('actuator', d.actuatorUrl);
      if (r.error) return [line(r.error, 'danger')];
      if (r.down) return [line(r.down, 'warn')];
      return [line(r.health.text, r.health.up === false ? 'danger' : ''), ...r.metrics.map((m) => line(`${m.label}: ${m.value}`))];
    }, [line(`Address: ${d.actuatorUrl} (change with insights.actuatorUrl in .ide/config.json)`, 'muted')]));
    out.push(sec('Test coverage in the editor', line('Shows green and red marks in the gutter, read from the coverage file your last test run left in the project (lcov.info, jacoco.xml, coverage.xml).', 'muted'), el('button', { onclick: () => { close(); toggleCoverage(); } }, ic('eye'), coverage.on ? 'Hide marks' : 'Show marks')));
    $('#dialog').replaceChildren(el('h3', { text: 'Usage & insights' }), el('div', { class: 'ins-list' }, ...out), el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
  }

  // ---------------------------------------------------------------- Setup & health: what works, what does not, one button per problem
  const LIGHT = { ok: ['check', 'st-A'], off: ['info', 'muted'], warn: ['circle-alert', 'warn'], bad: ['x', 'danger'] };
  const saveSetting = async (patch) => { const cur = await api.settings.get(); await api.settings.save({ ...cur.settings, ...patch }); await loadProject(); };
  async function healthAct(row, btn) {
    const a = row.action; if (!a) return;
    if (a.copy) { await api.copy(a.copy); btn.textContent = 'Copied: paste it in a terminal'; return; }
    btn.disabled = true;
    try {
      const cc = (state.project.config && state.project.config.agentContainer) || {};
      switch (a.id) {
        case 'build-image': {
          if (!window.confirm('Build the agent image now? It downloads Node, a JDK and Claude Code and takes a few minutes. Bazinga stays usable meanwhile.')) break;
          btn.textContent = 'Building… (a few minutes)';
          const r = await api.container.setup({ action: 'build' });
          if (r.error || !r.image) { window.alert(r.error || r.text); break; }
          break;
        }
        case 'container-on': await saveSetting({ agentContainer: { ...cc, enabled: true } }); break;
        case 'container-off': await saveSetting({ agentContainer: { ...cc, enabled: false } }); break;
        case 'hooks-on': await saveSetting({ agentHooks: true }); break;
        case 'hooks-off': await saveSetting({ agentHooks: false }); break;
        case 'capture-on': case 'capture-off': await api.capture.toggle(a.id === 'capture-on'); break;
        case 'confirm-version': await api.drift.confirm(); break;
        case 'hook-install': { const r = await api.gitHook.install(); if (r.error || !r.ok) window.alert(r.error || `Not installed: ${(r.skipped || []).join(', ') || 'unknown reason'}. You already have a pre-push hook of your own; Bazinga does not overwrite it.`); break; }
        case 'hook-remove': await api.gitHook.remove(); break;
        case 'copilot-on': await saveSetting({ copilot: { enabled: true } }); break;
        case 'copilot-usage': api.openExternal('https://github.com/settings/billing'); break;
        case 'jev-setup': await openJevSetup(); return;
        default: break;
      }
    } finally { btn.disabled = false; }
    await openDoctor();
  }

  async function openJevSetup() {
    const st = await api.jev.status();
    const key = el('input', { type: 'password', placeholder: st.hasKey ? 'A key is saved. Paste a new one to replace it.' : 'Paste your TypeSafe API key', autocomplete: 'off', spellcheck: 'false', style: 'width:100%' });
    const msg = el('div', { class: 'hint' });
    $('#dialog').replaceChildren(el('h3', { text: 'Smarter task recognition (Jev)' }),
      el('div', { class: 'hint', text: 'Jev is a fast online model from TypeSafe AI that only answers multiple-choice questions. Bazinga uses it to recognise what kind of task a run is (bug fix, tests, …) for the scorecard and the advice in “New agent run”. Without it, simple keyword rules on this computer do the same, a bit less accurately.' }),
      el('div', { class: 'hint', text: 'What is sent: the task text, nothing else (no code, no file names). TypeSafe documents its servers as US-hosted, so check with your employer before using it for work tasks. If Jev does not answer, the keyword rules take over.' }),
      el('div', { class: 'field' }, el('label', { text: 'API key' }), key, el('div', { class: 'hint', text: 'Stored encrypted by your operating system, never in a settings file.' })),
      msg,
      el('div', { class: 'actions' },
        st.enabled || st.hasKey ? el('button', { class: 'danger', onclick: async () => { await api.jev.forget(); await openDoctor(); } }, ic('trash-2'), 'Turn off and forget the key') : '',
        el('button', { onclick: openDoctor }, ic('chevron-left'), 'Back'),
        el('button', { class: 'primary', onclick: async () => {
          if (!key.value.trim() && st.hasKey) { await api.jev.toggle(true); await openDoctor(); return; }
          const r = await api.jev.saveKey({ key: key.value, enable: true });
          if (r.error) { msg.textContent = r.error; msg.classList.add('danger'); return; }
          await openDoctor();
        } }, ic('check'), 'Save and turn on')));
  }

  async function openDoctor() {
    const close = () => $('#modal').classList.add('hidden');
    $('#dialog').replaceChildren(el('h3', { text: 'Setup & health' }), el('div', { class: 'muted', text: 'Checking…' }));
    $('#modal').classList.remove('hidden');
    const [health, rep] = await Promise.all([api.health.get(), api.doctor()]);
    const lightOf = (r) => { const [icon, cls] = LIGHT[r.state] || LIGHT.off; return ic(icon, cls); };
    const rowEl = (r) => {
      const btn = r.action ? el('button', { class: r.state === 'bad' ? 'primary' : '', text: r.action.label, onclick: (ev) => healthAct(r, ev.currentTarget) }) : null;
      return el('div', { class: `health-row ${r.state}`, 'data-health': r.id }, lightOf(r), el('div', { class: 'doctor-main' }, el('b', { text: r.label }), el('span', { class: 'muted', text: r.text })), btn || '');
    };
    const main = health.error ? [] : health.rows.filter((r) => r.group !== 'advanced');
    const more = health.error ? [] : health.rows.filter((r) => r.group === 'advanced');
    const iconOf = (r) => (r.ok ? ic('check', 'st-A') : r.required ? ic('x', 'danger') : ic('circle-alert', 'warn'));
    const tools = rep.error ? [] : rep.results.map((r) => el('div', { class: 'doctor-row', title: r.path || '' },
      iconOf(r),
      el('div', { class: 'doctor-main' }, el('b', { text: r.label }), el('span', { class: 'muted', text: r.ok ? (r.version || 'found') : `${r.required ? 'required: ' : 'optional: '}${r.note ? `${r.note}. ` : ''}${r.hint}` }))));
    $('#dialog').replaceChildren(el('h3', { text: 'Setup & health' }),
      health.error ? el('div', { class: 'hint danger', text: health.error }) : el('div', { class: health.bad ? 'hint danger' : 'hint', id: 'health-summary', text: health.summary }),
      el('div', { class: 'doctor-list' },
        ...main.map(rowEl),
        more.length ? el('details', null, el('summary', { text: 'More (version watch, git hook, recording)' }), ...more.map(rowEl)) : '',
        el('details', null, el('summary', { text: `Tools on this computer${rep.ok === false ? ` · missing: ${rep.missingRequired.join(', ')}` : ''}` }), ...tools)),
      el('div', { class: 'actions' }, el('button', { id: 'health-again', onclick: openDoctor }, ic('refresh-cw'), 'Check again'), el('button', { onclick: () => openWalkthrough(0) }, ic('sparkles'), 'Walkthrough…'), el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    updateHealthDot(health);
  }

  // ---------------------------------------------------------------- first-run walkthrough
  const FIRST_TASK = 'Explain what this project does and list its main folders. Do not change any files.';
  function walkSeen(set) { try { if (set) localStorage.setItem('bazinga.walkthrough', '1'); return localStorage.getItem('bazinga.walkthrough') === '1'; } catch { return false; } }
  async function openWalkthrough(step = 0) {
    const close = () => { walkSeen(true); $('#modal').classList.add('hidden'); };
    const dots = el('div', { class: 'walk-steps' }, ...[0, 1].map((i) => el('span', { class: i <= step ? 'on' : '' })));
    $('#modal').classList.remove('hidden');
    if (step === 0) {
      $('#dialog').replaceChildren(el('h3', { text: 'Welcome to Bazinga' }), dots, el('div', { class: 'muted', text: 'Looking at what is on this computer…' }));
      const h = await api.health.get();
      const agents = (state.project && state.project.config && state.project.config.agents) || [];
      const rowOf = (id) => (h && !h.error ? h.rows.find((r) => r.id === id) : null);
      const claude = rowOf('claude');
      const status = (a) => {
        const local = rowOf('ollama') && /ollama|qwen|llama|gemma|mistral|deepseek/i.test(`${a.command} ${JSON.stringify(a.env || {})}`) ? rowOf('ollama') : null;
        if (/^\s*claude\b/.test(a.command) && !local) return claude ? { ok: claude.state === 'ok', text: claude.state === 'ok' ? 'Ready.' : claude.text } : { ok: true, text: '' };
        if (local) return { ok: local.state === 'ok', text: local.text };
        return { ok: true, text: 'Configured in your settings.' };
      };
      let picked = null;
      const choices = agents.map((a) => {
        const st = status(a);
        const box = el('div', { class: `walk-choice${st.ok ? '' : ' disabled'}`, 'data-agent': a.name }, el('div', null, el('b', { text: agentLabel(a) }), el('div', { class: 'muted', text: st.text || ' ' })));
        box.addEventListener('click', () => { if (!st.ok) return; picked = a; for (const c of document.querySelectorAll('#dialog .walk-choice')) c.classList.remove('picked'); box.classList.add('picked'); next.disabled = false; });
        return box;
      });
      const next = el('button', { class: 'primary', disabled: 'true', onclick: () => { rememberAgent(picked.name); openWalkthrough(1); } }, ic('chevron-right'), 'Next');
      $('#dialog').replaceChildren(el('h3', { text: 'Welcome to Bazinga' }), dots,
        el('div', { class: 'hint', text: 'Bazinga lets an AI agent work on your code in a separate copy, so your own files stay untouched until you decide. First, pick the agent you want to start with. You can change it any time.' }),
        choices.length ? el('div', null, ...choices) : el('div', { class: 'hint danger', text: 'No agent is set up yet. Open Settings → Agents and add Claude Code or a local model preset, then come back (command palette → Welcome walkthrough).' }),
        el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Not now'), el('button', { onclick: () => { walkSeen(true); openDoctor(); } }, ic('stethoscope'), 'Check everything…'), next));
      return;
    }
    $('#dialog').replaceChildren(el('h3', { text: 'Try a safe first run' }), dots,
      el('div', { class: 'hint', text: 'A first run that cannot change anything: the agent only reads the project and explains it. Bazinga makes a separate copy for it (a “run”). When it is done, open Changes to see the result; you can Merge it into your branch or Discard it, and the original is never touched until you merge.' }),
      el('div', { class: 'hint', text: 'Later, try something real: “Fix this bug: …” or “Write tests for …”. “Setup & health” in the command palette shows what works and fixes what does not.' }),
      el('div', { class: 'actions' }, el('button', { onclick: () => openWalkthrough(0) }, ic('chevron-left'), 'Back'), el('button', { onclick: close }, ic('fast-forward'), 'Skip'),
        el('button', { class: 'primary', id: 'walk-start', onclick: () => { walkSeen(true); openRunDialog({ task: FIRST_TASK, name: 'first look' }); } }, ic('play'), 'Start the first run')));
  }
  // once, for someone who has never started a run
  setTimeout(() => { if (!api.smoke && !walkSeen() && state.project && !((state.runs && state.runs.runs) || []).length) openWalkthrough(0); }, 2500);

  // a small marker in the status bar when something you use is not working; click for the screen
  function updateHealthDot(h) {
    const e = $('#status-health'); if (!e) return;
    const bad = h && !h.error ? h.bad : 0;
    e.textContent = bad ? `⚠ Setup: ${bad} to fix` : '';
    e.style.cursor = 'pointer';
    e.title = bad ? 'Something you use is not working. Click to see what and fix it.' : '';
  }
  $('#status-health').addEventListener('click', openDoctor);
  api.away.onMaybe(() => { if (!api.smoke) openAway({ auto: true }).catch(() => {}); });
  setTimeout(() => { if (!api.smoke && state.project && state.project.isRepo) openAway({ auto: true }).catch(() => {}); }, 3500);
  setTimeout(async () => { if (api.smoke) return; try { const c = await api.changelog.get(); if (c && c.unseen) { if (!walkSeen()) api.changelog.seen(c.hash); else if ($('#modal').classList.contains('hidden')) openWhatsNew(); } } catch { /* the changelog is a courtesy */ } }, 4000);
  setTimeout(() => { if (!api.smoke) api.health.get().then(updateHealthDot).catch(() => {}); }, 6000);

  const withTaskPrefix = (t) => { const px = state.project && state.project.config && state.project.config.taskPrefix; return px ? `${px}\n\n${t}` : t; };
  /** Start the agent in a terminal inside an existing run. Returns the terminal, null when it could not start, false when the container could not be prepared. */
  async function launchAgent(run, agent, task, cc, opts = {}) {
    if (agent.protocol === 'acp') return launchAcp(run, agent, task, cc, opts);
    let prep = null;
    const unattended = !!opts.unattended && !cc.enabled;
    if (!cc.enabled) { // a container cannot read the hint file on this machine: it runs the command as configured
      prep = await prepareAgent(agent, false, unattended);
      if (!prep) { await refreshRuns(); return false; }
    }
    const tpl = taskCommandFor(prep ? { ...agent, command: prep.command, taskCommand: prep.taskCommand } : agent);
    let input = tpl ? tpl.split('{task}').join(taskRef()) : (prep ? prep.command : agent.command);
    let termEnv = { ...(agent.env || {}), BAZINGA_TASK: withTaskPrefix(task) };
    let inlineAgentEnv = agent.env;
    if (prep && (prep.env || prep.envForce)) { inlineAgentEnv = { ...prep.env, ...(agent.env || {}), ...(prep.envForce || {}) }; termEnv = { ...inlineAgentEnv, BAZINGA_TASK: withTaskPrefix(task) }; }
    let hostEnv; let inContainer = false;
    if (cc.enabled) {
      const plan = await api.container.plan({ runId: run.id, task: withTaskPrefix(task), taskTemplate: tpl, agentCommand: agent.command, shell: shellKind() });
      if (plan.error) { window.alert(`Could not prepare the container:\n\n${plan.error}\n\nThe run was created but the agent was not started.`); await refreshRuns(); return false; }
      input = plan.command; termEnv = { ...plan.env }; hostEnv = plan.hostEnv; inContainer = true;
    }
    let printed = false;
    if (unattended && tpl) {
      const pc = await api.agent.printCommand(input, shellKind());
      if (pc) { input = pc; printed = true; } else dbg('agent', `${agent.name} is not a Claude Code command: unattended mode does not apply, it runs interactively`);
    } else if (unattended) dbg('agent', `${agent.name} cannot take a task on the command line: unattended mode does not apply`);
    const shown = withContext(agent, prep);
    dbg('agent', `launch ${agent.name} in ${run.root}${inContainer ? ' (container)' : ''}: ${String(input).slice(0, 200)}; task: ${String(task).slice(0, 120)}`);
    const entry = await newTerminal({ title: `${run.name} · ${shown}${inContainer ? ' 🐳' : ''}`, cwd: run.root, env: termEnv, inlineEnv: inContainer ? undefined : inlineAgentEnv, hostEnv, sandboxed: inContainer, initialInput: `${input}\r`, runId: run.id, watch: true, noEscalate: !!opts.noEscalate || !!opts.workflow, label: `${run.name} · ${shown}`, agent: agent.name, persist: true });
    if (entry && printed) entry.printMode = true;
    if (entry && prep && prep.local) { entry.local = prep.local; startKeepWarm(); }
    if (entry && prep && prep.otel && entry.id !== null) api.otel.bind(prep.otel.token, entry.id);
    if (entry && prep && prep.mcp && entry.id !== null) api.mcp.bind(prep.mcp.token, entry.id);
    if (entry && prep && prep.hook && entry.id !== null) { entry.hooked = true; api.hooks.bind(prep.hook.token, entry.id); dbg('hook', `terminal ${entry.id}: Claude Code reports Stop / Notification / UserPromptSubmit to Bazinga by itself`); }
    if (!tpl && entry && entry.id !== null) {
      // agents that cannot take a prompt as an argument: paste it into their input box (not submitted)
      setTimeout(() => { api.pty.write(entry.id, `\x1b[200~${withTaskPrefix(task)}\x1b[201~`); setStatus('The task was pasted into the agent. Press Enter to send it.'); }, 3000);
    }
    return entry;
  }

  /** same rule as core/container.js containerDecision (the renderer cannot require it) */
  function containerDecisionUi({ enabled, unattended, setting = 'auto', ready }) {
    if (enabled) return { use: true, why: 'setting' };
    if (!unattended) return { use: false, why: 'attended' };
    if (setting === 'off') return { use: false, why: 'off' };
    return ready ? { use: true, why: 'auto' } : { use: false, why: 'not-ready' };
  }

  async function startRun({ task, name, agent, allow, activate = true, noEscalate = false, container = undefined }) {
    const cc = { ...((state.project.config && state.project.config.agentContainer) || {}) };
    if (typeof container === 'boolean') cc.enabled = container; // the run dialog's own choice wins over the setting
    if (cc.enabled) {
      const chk = await api.container.check();
      if (chk.error || !chk.docker) { window.alert(`Agent runs are set to run in a container, but Docker was not found.\n\nInstall Docker (and build the image: docker build -t ${chk.image || 'bazinga-agent:latest'} docker/agent), or turn the option off in Settings → Agent safety. Nothing was started.`); return null; }
    }
    const res = await api.runs.create({ name, task, agent: agent.name, allow });
    if (res.error) { window.alert(`Could not create the run:\n\n${res.error}`); return null; }
    const run = res.run;
    if (activate) {
      if (!(await switchRoot(run.root))) return null;
      const snap = await api.scope.snapshot(); // the copied .ide/ folder is untracked: it must not count as the agent's work
      state.task = { allow, summary: '', baseline: (snap && snap.baseline) || {}, reviewed: {}, started: Date.now() };
      $('#t-allow').value = allow; $('#t-summary').value = '';
      await refreshChanges();
      scheduleSessionSave();
      setSideTab('agents');
    }

    const entry = await launchAgent(run, agent, task, cc, { noEscalate });
    if (entry === false) return null;
    await refreshRuns();
    return { run, entry };
  }

  function guardRows(guard) {
    if (guard.clean) return [el('div', { class: 'guard-row ok' }, ic('circle-check'), el('span', { text: 'Gates are green, everything is in scope and reviewed.' }))];
    return guard.items.map((i) => el('div', { class: `guard-row ${i.level}`, title: (i.files || []).join('\n') },
      ic(i.level === 'block' ? 'circle-alert' : 'triangle-alert'),
      el('div', null, el('div', { text: i.text }),
        i.files && i.files.length ? el('div', { class: 'muted small', text: `${i.files.slice(0, 5).join(', ')}${i.files.length > 5 ? `, +${i.files.length - 5} more` : ''}` }) : null)));
  }

  async function mergeRunDialog(run) {
    const viewing = !!(state.runs && state.runs.current === run.root);
    const msg = el('input', { type: 'text', value: run.name, spellcheck: 'false' });
    const squash = el('input', { type: 'checkbox' }); squash.checked = true;
    const override = el('input', { type: 'checkbox' });
    const overrideRow = el('label', { class: 'check guard-override hidden' }, override, ' I have looked at the blockers above and want to merge anyway');
    const guardBox = el('div', { class: 'guard' }, el('div', { class: 'hint', text: 'Running the gates on this run…' }));
    const mergeBtn = el('button', { class: 'primary' }, ic('git-merge'), 'Merge');
    const prBtn = el('button', { title: 'Push the branch and open a pull request instead of merging locally' }, ic('git-pull-request'), 'Open pull request…');
    mergeBtn.disabled = true;
    const close = () => $('#modal').classList.add('hidden');
    let guard = null;
    const sync = () => { mergeBtn.disabled = !guard || (!guard.ok && !override.checked); };
    override.addEventListener('change', sync);
    mergeBtn.addEventListener('click', async () => {
      close();
      if (viewing && !(await switchRoot(state.runs.main.root))) return;
      setStatus('Merging…');
      const overriddenItems = override.checked && guard ? guard.items.filter((i) => i.level === 'block').map((i) => i.id) : [];
      const res = await api.runs.merge({ id: run.id, message: msg.value, squash: squash.checked, overriddenItems });
      if (res.error) { window.alert(res.error); setStatus('Merge failed.'); await refreshRuns(); return; }
      for (const t of state.terms.values()) if (t.runId === run.id && t.id !== null && !t.exited) api.pty.kill(t.id);
      await renderTree(); await refreshChanges(); await refreshRuns(); await loadProject();
      setStatus(`Merged ${res.result.merged} into ${res.result.into || 'your branch'}.`);
    });
    prBtn.addEventListener('click', () => openPrDialog(run, guard));
    fill($('#dialog'),
      el('h3', { text: `Merge “${run.name}”` }),
      guardBox, overrideRow,
      el('div', { class: 'field' }, el('label', { text: 'Commit message' }), msg),
      el('div', { class: 'field' }, el('label', { class: 'check' }, squash, ' Squash into a single commit')),
      el('div', { class: 'hint', text: 'Requires a clean main working tree. On conflicts nothing is changed.' }),
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Cancel'), prBtn, mergeBtn));
    $('#modal').classList.remove('hidden');

    const reviewed = viewing && state.scope ? state.scope.files.map((f) => f.path).filter(isReviewed) : [];
    const res = await api.runs.guard({ id: run.id, reviewed, summary: viewing ? state.task.summary : '', allow: viewing ? state.task.allow : undefined });
    let verdictRow = null; let symbolRow = null;
    if (res.error) {
      guard = { ok: false, clean: false, blockers: 1, warnings: 0, items: [{ id: 'gatesNotRun', level: 'block', text: `Could not check this run: ${res.error}` }] };
    } else {
      guard = res.guard;
      // the same fused verdict auto-merge itself would use, shown here even when auto-merge is off or did not qualify
      const v = res.verdict;
      if (v) {
        const vClass = v.level === 'ready' ? 'ok' : v.level === 'blocked' ? 'block' : 'warn';
        verdictRow = el('div', { class: `guard-row verdict ${vClass}`, title: v.detail },
          ic(v.level === 'ready' ? 'circle-check' : v.level === 'blocked' ? 'circle-alert' : 'triangle-alert'),
          el('div', null, el('div', { text: v.label }), el('div', { class: 'muted small', text: v.detail })));
      }
      if (res.symbolChanges) symbolRow = el('div', { class: 'guard-row ok muted' }, ic('git-compare-arrows'), el('span', { text: `${res.symbolChanges} symbol change${res.symbolChanges === 1 ? '' : 's'} across this run’s files` }));
    }
    fill(guardBox, el('div', { class: 'guard-head', text: guard.clean ? 'Ready to merge' : guard.ok ? `${guard.warnings} thing${guard.warnings === 1 ? '' : 's'} to look at` : `${guard.blockers} blocker${guard.blockers === 1 ? '' : 's'}, ${guard.warnings} warning${guard.warnings === 1 ? '' : 's'}` }),
      ...(verdictRow ? [verdictRow] : []), ...(symbolRow ? [symbolRow] : []), ...guardRows(guard));
    overrideRow.classList.toggle('hidden', guard.ok);
    sync();
    if (!guard.ok) await addGuardSuggestions(guardBox, guard, run);
  }

  // adaptive guard rules: one row offering to relax a blocker once it has been overridden past the threshold.
  // Shared by the merge dialog and Settings -> Merge guard, which surfaces the same suggestions at any time,
  // not only at the moment of an override.
  function guardSuggestionRow(s, label, { onRelaxed, onDismissed }) {
    const relaxBtn = el('button', null, ic('unlock'), `Relax to ${s.next === 'off' ? 'ignore' : s.next}`);
    const projectBtn = state.project ? el('button', { title: 'Writes to this project’s .ide/config.json, so the whole team gets the relaxed rule.' }, ic('git-branch'), 'Relax for this project') : null;
    const dismissBtn = el('button', null, ic('x'), 'Not now');
    relaxBtn.addEventListener('click', async () => { await api.guardoverrides.relax(s.id); onRelaxed(s); });
    if (projectBtn) projectBtn.addEventListener('click', async () => { await api.guardoverrides.relaxProject(s.id); onRelaxed(s); });
    dismissBtn.addEventListener('click', async () => { await api.guardoverrides.dismiss(s.id); onDismissed(row); });
    const row = el('div', { class: 'line wrap' }, el('span', { text: `You have overridden “${label}” ${s.count} times.` }), relaxBtn, ...(projectBtn ? [projectBtn] : []), dismissBtn);
    return row;
  }

  async function addGuardSuggestions(guardBox, guard, run) {
    const got = await api.guardoverrides.get();
    const relevant = (got.suggestions || []).filter((s) => guard.items.some((i) => i.id === s.id && i.level === 'block'));
    if (!relevant.length) return;
    guardBox.appendChild(el('div', { class: 'guard-suggestion' }, ...relevant.map((s) => {
      const item = guard.items.find((i) => i.id === s.id);
      return guardSuggestionRow(s, item.text, { onRelaxed: () => mergeRunDialog(run), onDismissed: (row) => row.remove() });
    })));
  }

  async function openPrDialog(run, guard) {
    const info = await api.runs.remote();
    const remote = (info && info.remote) || {};
    const title = el('input', { type: 'text', value: run.name, spellcheck: 'false' });
    const body = el('textarea', { rows: '5', spellcheck: 'false' });
    body.value = [run.task ? `Task given to the agent:\n${run.task}` : '', guard && !guard.clean ? `Open points at the time of the PR:\n${guard.items.map((i) => `- ${i.text}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    const base = el('input', { type: 'text', value: run.baseBranch || (state.runs && state.runs.main && state.runs.main.branch) || 'main', spellcheck: 'false' });
    const draft = el('input', { type: 'checkbox' }); draft.checked = true;
    const out = el('div', { class: 'hint' });
    const close = () => $('#modal').classList.add('hidden');
    const hostName = { github: 'GitHub', azure: 'Azure DevOps', gitlab: 'GitLab' }[remote.host];
    const how = !remote.hasOrigin ? 'This repository has no “origin” remote, so there is nothing to push to.'
      : remote.cli && remote.cliFound ? `The branch is pushed to origin and the pull request is created with ${remote.cli} (${hostName}).`
        : remote.cli ? `${hostName}: the branch is pushed, but “${remote.cli}” is not installed, so you create the pull request in the browser.`
          : 'The branch is pushed to origin. This Git host has no CLI integration: create the pull request there.';
    const go = el('button', { class: 'primary' }, ic('git-pull-request'), 'Push and create');
    go.disabled = !remote.hasOrigin;
    go.addEventListener('click', async () => {
      go.disabled = true; out.className = 'hint'; out.textContent = 'Pushing…';
      const res = await api.runs.pr({ id: run.id, title: title.value, body: body.value, base: base.value, draft: draft.checked });
      if (res.error) { out.className = 'hint bad'; out.textContent = res.error; go.disabled = false; return; }
      const r = res.result;
      fill(out, r.url ? el('div', null, 'Pull request created: ', el('a', { href: '#', text: r.url, onclick: (e) => { e.preventDefault(); api.openExternal(r.url); } })) : el('div', { text: r.output }),
        r.url ? el('div', { class: 'line' }, el('button', { onclick: () => { api.copy(r.url); setStatus('Link copied.'); } }, ic('link'), 'Copy link'), el('button', { onclick: () => api.openExternal(r.url) }, ic('external-link'), 'Open in browser')) : null);
      out.className = 'hint good';
      await refreshRuns();
    });
    fill($('#dialog'),
      el('h3', { text: `Pull request for “${run.name}”` }),
      el('div', { class: 'field' }, el('label', { text: 'Title' }), title),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), body),
      el('div', { class: 'field' }, el('label', { text: 'Target branch' }), base),
      el('div', { class: 'field' }, el('label', { class: 'check' }, draft, ' Create as draft')),
      el('div', { class: 'hint', text: how }), out,
      el('div', { class: 'actions' }, el('button', { onclick: close }, ic('x'), 'Close'), go));
    $('#modal').classList.remove('hidden');
  }

  async function discardRun(run) {
    if (!window.confirm(`Discard “${run.name}”?\n\nThe worktree and the branch ${run.branch} are deleted, including everything the agent did.`)) return;
    if (state.runs && state.runs.current === run.root && !(await switchRoot(state.runs.main.root))) return;
    for (const t of state.terms.values()) if (t.runId === run.id && t.id !== null && !t.exited) api.pty.kill(t.id);
    const res = await api.runs.discard(run.id);
    if (res.error) { window.alert(res.error); return; }
    await refreshRuns();
    setStatus(`Discarded ${run.branch}.`);
  }

  // a stronger agent takes over the working copy of a run whose first agent could not get the gates clean (decided in the main process)
  async function handleEscalation(e) {
    try {
      await refreshRuns();
      const run = ((state.runs && state.runs.runs) || []).find((r) => r.id === e.runId);
      const agent = ((state.project.config && state.project.config.agents) || []).find((a) => a.name === e.agent);
      if (!run || !agent) { setStatus('The hand-over could not start: the run or the agent is gone.'); return; }
      const from = [...state.terms.values()].find((t) => t.id === e.from);
      if (from) from.escalatedTo = agent.name;
      setStatus(`${(from && from.agent) || 'The first agent'} could not get the gates clean. “${run.name}” is handed over to ${agentLabel(agent)}; it continues in the same working copy.`);
      dbg('agent', `escalation: ${(from && from.agent) || '?'} → ${agent.name} in ${run.root}`);
      const cc = (state.project.config && state.project.config.agentContainer) || {};
      await launchAgent(run, agent, e.prompt, cc, { noEscalate: true });
      renderAgentsPane();
    } catch (err) { setStatus(`Hand-over failed: ${err.message}`); }
  }
  api.fixloop.onEscalate(handleEscalation);
  api.drift.onNotice((text) => setStatus(text));

  // ---------------------------------------------------------------- scorecard: what happened to each agent's runs, per kind of task
  const scTime = (ms) => { if (!ms) return '–'; const sec = Math.round(ms / 1000); if (sec < 60) return `${sec}s`; const m = Math.round(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const scCost = (v) => (v === 0 ? 'free' : v === null || v === undefined ? '?' : v < 0.01 ? '<$0.01' : `$${v.toFixed(v < 10 ? 2 : 1)}`);
  async function openScorecard() {
    const close = () => $('#modal').classList.add('hidden');
    const [sc, go] = await Promise.all([api.scorecard.get(), api.guardoverrides.get()]);
    const body = [];
    if (!sc || sc.error || !sc.total) {
      body.push(el('div', { class: 'empty', text: 'Nothing recorded yet. Every time you merge or discard an agent run, one line is added here: which agent, what kind of task, and what you did with the result.' }));
    } else {
      for (const kind of sc.kinds) {
        const rows = sc.rows.filter((r) => r.kind === kind);
        if (!rows.length) continue;
        body.push(el('h4', { class: 'sc-kind', text: sc.labels[kind] }));
        if (sc.recs[kind]) body.push(el('div', { class: 'sc-rec', text: `Best so far: ${sc.recs[kind]}` }));
        body.push(el('table', { class: 'sc-table' },
          el('thead', null, el('tr', null, ...['Agent', 'Runs', 'Alone', 'Needed help', 'Lost', 'Discarded', 'Fix loop', 'Typical time', 'Cost per merge'].map((h) => el('th', { text: h })))),
          el('tbody', null, ...rows.map((r) => el('tr', { class: r.enough ? '' : 'faded', title: r.enough ? '' : `Fewer than ${sc.minRuns} runs: an anecdote, not a pattern` },
            el('td', null, r.agent, r.local ? el('span', { class: 'chip', text: 'local' }) : ''),
            el('td', { text: String(r.runs) }), el('td', { text: `${r.win} (${Math.round(r.winRate * 100)}%)` }), el('td', { text: String(r.helped) }), el('td', { text: String(r.lost) }), el('td', { text: String(r.failed) }),
            el('td', { text: r.loopRuns ? `${r.firstPass}/${r.loopRuns} clean first time${r.avgRounds ? ` · ${r.avgRounds.toFixed(1)} rounds` : ''}` : '–' }),
            el('td', { text: scTime(r.medianMs) }),
            el('td', { text: scCost(r.costPerMerged), title: r.local ? 'Runs on your own machine' : 'Everything this agent cost for this kind of task, failed attempts included, divided by the merged runs. From the agent’s own telemetry.' }))))));
      }
    }
    // guard-override transparency: counts per rule, so you can see what you have been overriding before you are asked about it again
    const overrideCounts = Object.entries((go && go.counts) || {}).sort((a, b) => b[1] - a[1]);
    if (overrideCounts.length) {
      body.push(el('h4', { class: 'sc-kind', text: 'Guard overrides' }),
        el('div', { class: 'hint', text: 'How many times you have ticked “merge anyway” past each blocker, across every project. Overriding the same one a few times offers to relax it (Settings → Merge guard).' }),
        el('table', { class: 'sc-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Rule' }), el('th', { text: 'Times overridden' }))),
          el('tbody', null, ...overrideCounts.map(([id, count]) => el('tr', null, el('td', { text: GUARD_LABELS[id] || id }), el('td', { text: String(count) }))))));
    }
    $('#dialog').replaceChildren(el('h3', { text: 'Scorecard' }),
      el('div', { class: 'hint', text: `Counted from what you did with each run (${(sc && sc.total) || 0} so far). “Alone” = merged without a stronger agent taking over. “Lost” = another run of the same task was kept. “Cost per merge” counts failed attempts too; “?” means the agent reported no cost. Rows with fewer than ${(sc && sc.minRuns) || 3} runs are faded: too few to trust.` }),
      el('div', { class: 'sc-body' }, ...body),
      el('div', { class: 'actions' },
        sc && sc.total ? el('button', { class: 'danger', onclick: async () => { if (window.confirm('Forget the whole scorecard? This cannot be undone.')) { await api.scorecard.clear(); openScorecard(); } } }, ic('trash-2'), 'Clear history…') : '',
        el('button', { class: 'primary', onclick: close }, ic('check'), 'Close')));
    $('#modal').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- fix loop status (the loop itself runs in the main process)
  function termIsInViewedRoot(ptyId) {
    const t = [...state.terms.values()].find((x) => x.id === ptyId);
    if (!t) return false;
    if (!t.runId) return !!(state.runs && state.runs.main && state.runs.current === state.runs.main.root) || !(state.runs && state.runs.runs.length);
    const run = state.runs && state.runs.runs.find((r) => r.id === t.runId);
    return !!run && state.project && state.project.root === run.root;
  }
  const FIX_TEXT = { checking: 'checking the gates…', fixing: 'sent the findings back to the agent', done: 'gates are green', stop: 'stopped', error: 'could not run the gates' };
  api.fixloop.onStatus((evt) => {
    for (const t of state.terms.values()) if (t.id === evt.id) t.fix = ['done', 'stop', 'error'].includes(evt.state) ? { ...evt } : evt;
    const round = evt.state === 'fixing' ? ` (round ${evt.round}/${evt.maxRounds})` : '';
    setStatus(`Fix loop · ${evt.label}: ${FIX_TEXT[evt.state] || evt.state}${round}${evt.reason && evt.state !== 'fixing' ? ` · ${evt.reason}` : ''}`);
    renderBottomTabs();
    renderAgentsPane();
    if ((evt.state === 'done' || evt.state === 'stop') && termIsInViewedRoot(evt.id)) runChecks('fast'); // show the same findings in Problems
  });
  api.onAgentIdle((id) => { for (const t of state.terms.values()) if (t.id === id) { t.idleAt = Date.now(); fleetEvent(t, 'idle', 'finished a turn, waiting for you'); } renderAgentsPane(); });
  $('#fixloop').addEventListener('change', async (e) => {
    const cur = await api.settings.get();
    const base = (cur.settings.fixLoop) || {};
    await api.settings.save({ ...cur.settings, fixLoop: { ...cur.defaults.fixLoop, ...base, enabled: e.target.checked } });
    await loadProject();
    setStatus(e.target.checked ? 'Fix loop on: when an agent goes quiet the gates run and the findings go back to it.' : 'Fix loop off.');
  });

  // ---------------------------------------------------------------- wiring
  let autoTimer = null;
  let todosTimer = null;
  const showWatcher = (ok) => { const e = $('#status-watch'); if (e) { e.textContent = ok ? '● live' : '⚠ polling'; e.style.cursor = 'pointer'; e.title = (ok ? 'File watching is on.' : 'Live file watching stopped (the IDE keeps checking every few seconds and when you return to the window) and is being restarted.') + ' Click for details.'; } };
  $('#status-watch').addEventListener('click', async () => {
    const d = await api.fs.diagnostics();
    alert(['File watching', ...Object.entries(d).map(([k, v]) => `${k}: ${v === null ? '-' : v}`)].join('\n'));
  });
  api.fs.onWatcher(showWatcher);
  // Refreshes after a file change: the steps are independent (one failing or hanging must not block the others),
  // and a change that arrives while a refresh is running schedules exactly one more round instead of being lost.
  let refreshing = false; let refreshAgain = false;
  const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  async function refreshAfterChange(info) {
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        state.quick.stale = true;
        state.blame.rel = null;
        await Promise.allSettled([
          within(reloadFromDisk(), 15000),
          within(renderTree(), 15000),
          within(refreshChanges(), 15000),
        ]);
        if (state.runs && state.runs.runs && state.runs.runs.length && state.sideTab === 'agents') refreshRuns();
      } while (refreshAgain);
    } finally { refreshing = false; }
    if (!(info && info.poll) && state.autoCheck && !state.checksRunning) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => runChecks('fast'), 1200);
    }
    if (!(info && info.poll) && !state.todos.scanning) {
      clearTimeout(todosTimer);
      todosTimer = setTimeout(() => scanTodos(), 1200);
    }
  }
  api.fs.onChanged((info) => { refreshAfterChange(info); });
  api.dap.onEvent((event, body) => handleDapEvent(event, body));

  async function switchProject(dir) {
    const before = state.project && state.project.root;
    if (dir && before) {
      const running = await api.project.running();
      if (running > 0 && !confirm(`Switching project closes the ${running} running terminal${running === 1 ? '' : 's'} (and agents) in this window.\n\nTip: "Open in new window" keeps them running. Switch anyway?`)) return;
    }
    const next = await api.project.open(dir);
    if (next.root && next.root !== before) { await resetWorkspace(); await loadProject(); restoreSession((await api.session.get()).project); }
  }

  /** Add/remove one folder of the workspace, leaving every other open folder's tabs, terminals and agents alone. */
  async function addWorkspaceFolder(dir) { await api.project.addFolder(dir); await loadProject(); }
  async function removeWorkspaceFolder(root) {
    if (((state.project && state.project.roots) || []).length <= 1) { setStatus('That’s the only open folder — use "Open folder…" to replace it instead.'); return; }
    if (!window.confirm(`Remove "${rootName(root)}" from this workspace?\n\nTerminals already running against it keep running; it just leaves the file tree, search and git status.`)) return;
    for (const t of [...state.tabs].filter((t) => t.root === root)) await closeTab(t.id);
    await api.project.removeFolder(root);
    await loadProject();
  }

  /** The project button: recent projects, open a folder here, or open one in a new window (its own process: nothing running here is touched). */
  async function openProjectMenu() {
    closeProjectMenu();
    const recent = await api.project.recent();
    const btn = $('#btn-open');
    const r = btn.getBoundingClientRect();
    const item = (label, title, onClick, extra) => el('div', { class: 'pm-item', title, onclick: () => { closeProjectMenu(); onClick(); } }, [el('span', { class: 'pm-label', text: label }), ...(extra ? [extra] : [])]);
    const menu = el('div', { id: 'project-menu', class: 'project-menu' }, [
      ...(recent.length ? [el('div', { class: 'pm-head', text: 'Recent projects' })] : []),
      ...recent.map((dir) => item(dir.split(/[\\/]/).filter(Boolean).pop() || dir, dir, () => switchProject(dir),
        el('button', { class: 'pm-win', title: 'Open in a new window', 'aria-label': 'Open in a new window', onclick: (e) => { e.stopPropagation(); closeProjectMenu(); api.project.openWindow(dir); } }, ic('external-link')))),
      ...(recent.length ? [el('div', { class: 'pm-sep' })] : []),
      item('Add folder to workspace…', 'Open another folder alongside this one - its own section in the tree, its own git status', () => addWorkspaceFolder(null)),
      ...((state.project && state.project.roots && state.project.roots.length > 1) ? state.project.roots.map((p) => item(`Remove "${p.name}" from workspace`, p.root, () => removeWorkspaceFolder(p.root))) : []),
      el('div', { class: 'pm-sep' }),
      item('Open folder…', 'Replace the whole workspace in this window', () => switchProject(null)),
      item('Open folder in new window…', 'Keep this window and its running terminals as they are', () => api.project.openWindow(null)),
    ]);
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom + 2)}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', outsideProjectMenu, true), 0);
  }
  function closeProjectMenu() { const m = $('#project-menu'); if (m) m.remove(); document.removeEventListener('mousedown', outsideProjectMenu, true); }
  function outsideProjectMenu(e) { const m = $('#project-menu'); if (m && !m.contains(e.target)) closeProjectMenu(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProjectMenu(); });
  $('#btn-open').addEventListener('click', () => { if ($('#project-menu')) closeProjectMenu(); else openProjectMenu(); });
  $('#btn-term').addEventListener('click', () => newTerminal({ title: 'Terminal' }));
  $('#btn-fast').addEventListener('click', () => runChecks('fast'));
  $('#btn-all').addEventListener('click', () => runChecks('all'));
  $('#btn-review').addEventListener('click', runReview);
  async function setThemeSetting(next) {
    const cur = await api.settings.get();
    await api.settings.save({ ...cur.settings, theme: next });
    themeSetting = next;
    applyTheme();
  }
  // a quick light/dark toggle, not a picker - the full list of themes lives in Settings -> General -> Theme
  $('#btn-theme').addEventListener('click', () => setThemeSetting(themeToggleTarget()));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#auto').addEventListener('change', (e) => { state.autoCheck = e.target.checked; scheduleSessionSave(); });
  $('#btn-refresh').addEventListener('click', async () => { await renderTree(); await refreshChanges(); await refreshCheckpoints(); await reloadFromDisk(); });
  for (const b of document.querySelectorAll('#side-tabs button[data-tab]')) b.addEventListener('click', () => setSideTab(b.dataset.tab));
  $('#side-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const tabs = [...document.querySelectorAll('#side-tabs button[data-tab]')];
    const at = tabs.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    const next = tabs[(at + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
    setSideTab(next.dataset.tab);
    next.focus();
  });
  $('#d-prev').addEventListener('click', () => gotoChange(-1));
  $('#d-next').addEventListener('click', () => gotoChange(1));
  $('#d-revert-hunk').addEventListener('click', revertHunk);
  $('#d-comment').addEventListener('click', commentAtCursor);
  $('#d-send-comments').addEventListener('click', () => sendComments());
  $('#d-reviewed').addEventListener('click', () => { const t = activeTab(); if (t) setReviewed(t.rel, !isReviewed(t.rel)); });
  $('#d-stage-hunk').addEventListener('click', () => stageChangeAtCursor(false));
  $('#d-unstage-hunk').addEventListener('click', () => stageChangeAtCursor(true));
  $('#d-stage').addEventListener('click', () => { const t = activeTab(); if (t) toggleStage(t.rel, t.root); });
  $('#d-revert-file').addEventListener('click', () => { const t = activeTab(); if (t) revertWholeFile(t.rel, t.root); });
  $('#q').addEventListener('input', scheduleSearch);
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
  for (const [id, key] of [['q-case', 'caseSensitive'], ['q-re', 'regex']]) {
    $(`#${id}`).addEventListener('click', () => { state.search[key] = !state.search[key]; $(`#${id}`).classList.toggle('on', state.search[key]); runSearch(); });
  }
  async function replaceAll() {
    const query = $('#q').value;
    const replacement = $('#q-replace').value;
    if (!query) { $('#q').focus(); return; }
    if (!window.confirm(`Replace every match of "${query}" with "${replacement}" in every file currently shown?\n\nEach changed file gets a local-history snapshot first, so this can be undone per file.`)) return;
    const res = await api.search.replace({ query, regex: state.search.regex, caseSensitive: state.search.caseSensitive, replacement });
    if (res.error) { setStatus(res.error); return; }
    setStatus(res.replacements ? `Replaced ${res.replacements} match${res.replacements === 1 ? '' : 'es'} in ${res.files} file${res.files === 1 ? '' : 's'}.` : 'No matches to replace.');
    await runSearch();
  }
  $('#q-replace-all').addEventListener('click', replaceAll);
  $('#q-replace').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceAll(); } });
  $('#qo-input').addEventListener('input', () => { state.quick.sel = 0; renderQuick(); });
  $('#qo-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); state.quick.sel = Math.min(state.quick.sel + 1, state.quick.items.length - 1); renderQuick(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.quick.sel = Math.max(state.quick.sel - 1, 0); renderQuick(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickQuick(state.quick.sel); }
  });
  $('#quickopen').addEventListener('mousedown', (e) => { if (e.target.id === 'quickopen') closeQuickOpen(); });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });

  // Focus trap + restore for the generic modal dialog and the board overlay: move focus in on open (unless the
  // opener already focused something inside, e.g. a text field), cycle Tab within it, and give focus back to
  // whatever opened it on close — regardless of which of the ~30 call sites did the opening/closing.
  function wireDialogFocus(overlay, content) {
    let prevFocus = null;
    let wasHidden = overlay.classList.contains('hidden');
    const focusableSel = 'input, textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    new MutationObserver(() => {
      const hidden = overlay.classList.contains('hidden');
      if (hidden === wasHidden) return;
      wasHidden = hidden;
      if (!hidden) {
        prevFocus = document.activeElement;
        if (!content.contains(document.activeElement)) {
          // querySelector alone would also match an element inside a currently-hidden tab panel (e.g. Settings'
          // non-active tabs): .focus() on a display:none element is a silent no-op, so initial focus never landed.
          const first = [...content.querySelectorAll(focusableSel)].find((el) => el.offsetParent !== null);
          if (first) first.focus();
        }
      } else if (prevFocus && document.body.contains(prevFocus) && typeof prevFocus.focus === 'function') {
        prevFocus.focus();
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || overlay.classList.contains('hidden')) return;
      const items = [...content.querySelectorAll(focusableSel)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  wireDialogFocus($('#modal'), $('#dialog'));
  wireDialogFocus($('#board'), $('#board'));

  // right-click on empty space below the rows: same menu as the project root folder
  $('#side-files').addEventListener('contextmenu', (ev) => { if (!ev.target.closest('.row')) rowMenu(ev, state.project && state.project.root, '', true); });

  // Settings -> Keyboard rebinds any of these; Escape's "close the innermost thing" stays a dedicated,
  // non-remappable branch ahead of the generic dispatch (it closes whichever of several things is open,
  // not one single command). Everything else: look up the event's chord in the resolved keymap and run
  // whichever command owns it, so a rebind in Settings takes effect without touching this listener.
  const KEYBIND_ACTIONS = {
    goToFile: openQuickOpen,
    goToSymbol: openGotoSymbol,
    commandPalette: openPalette,
    focusSearch,
    saveFile: saveActive,
    newTerminal: () => newTerminal({ title: 'Terminal' }),
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeQuickOpen(); $('#modal').classList.add('hidden'); if (boardUi.open) closeBoard(); else if (state.zen) toggleZen(); return; }
    const chord = chordFromEvent(e);
    if (!chord) return;
    const km = resolvedKeymap();
    const id = Object.keys(KEYBIND_ACTIONS).find((cid) => km[cid] === chord);
    if (id) { e.preventDefault(); KEYBIND_ACTIONS[id](); }
  });

  function drag(handle, onMove) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const up = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up); document.body.style.userSelect = ''; scheduleSessionSave(); };
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', up);
    });
  }
  drag($('#split-side'), (e) => {
    const railW = $('#side-tabs').getBoundingClientRect().width;
    document.documentElement.style.setProperty('--side-w', `${Math.min(Math.max(e.clientX - railW, 160), 640)}px`);
  });
  drag($('#split-bottom'), (e) => {
    const rect = $('#center').getBoundingClientRect();
    document.documentElement.style.setProperty('--bottom-h', `${Math.min(Math.max(rect.bottom - e.clientY, 80), rect.height - 160)}px`);
    fitActive();
  });
  drag($('#split-editor2'), (e) => {
    const rect = $('#editor-split').getBoundingClientRect();
    document.documentElement.style.setProperty('--editor2-w', `${Math.min(Math.max(rect.right - e.clientX, 160), rect.width - 200)}px`);
  });

  // ---------------------------------------------------------------- memory in the status bar
  async function pollMemory() {
    try { const m = await api.memory(); if (m && m.mb) $('#status-mem').textContent = `${m.mb >= 1024 ? `${(m.mb / 1024).toFixed(1)} GB` : `${m.mb} MB`}  ·  `; } catch { /* not available */ }
  }
  setInterval(pollMemory, 5000);
  pollMemory();

  // ---------------------------------------------------------------- start
  try {
    await initEditors();
  } catch (err) {
    document.body.prepend(el('pre', { class: 'detail', text: `Monaco failed to load: ${err && err.message ? err.message : err}` }));
    if (api.smoke) api.smokeDone({ ok: false, stage: 'monaco', error: String((err && err.message) || err), errors });
    return;
  }
  initChangesPane();
  initAgentsPane();
  renderProblems();
  showBottom('problems');
  const saved = await api.session.get();
  if (saved.ui && saved.ui.sideW) document.documentElement.style.setProperty('--side-w', saved.ui.sideW);
  if (saved.ui && saved.ui.bottomH) document.documentElement.style.setProperty('--bottom-h', saved.ui.bottomH);
  applyStaticIcons();
  applyTheme();
  await loadProject();
  api.appReady();
  if (!api.smoke) await restoreSession(saved.project);


  // ---------------------------------------------------------------- screenshot scenario (scripts/screenshots.js): drives the real UI against a demo project
  if (api.smoke && api.shots) {
    try { // a failing scenario must report itself instead of leaving the screenshot script waiting
    const shot = async (name, wait = 700) => { await sleep(wait); await api.shot(name); };
    const demoAgent = (name) => ({ name, command: 'node tools/demo-agent.js', taskCommand: 'node tools/demo-agent.js {task}' });
    const commitAll = async (msg) => { await api.git.stageAll(state.project.root, ); await api.git.commit(state.project.root, msg); };
    const mainRoot = state.project.root;
    if (api.shotsTheme) await setThemeSetting(api.shotsTheme);

    // run C: finished, committed on its own
    const c = await startRun({ task: 'Refactor the format utils: one currency formatter, no duplicated rounding code', name: 'format utils refactor', agent: demoAgent('Claude'), allow: 'src/utils/**' });
    await api.fs.write(state.project.root, 'src/utils/format.js', "export const currency = (cents, locale = 'nl-BE') =>\n  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);\n\nexport const percent = (ratio) => `${Math.round(ratio * 100)}%`;\n");
    await commitAll('Refactor format utils');
    await api.fs.write(state.project.root, 'src/utils/format.test.js', "import { describe, it, expect } from 'vitest';\nimport { currency, percent } from './format';\n\ndescribe('currency', () => {\n  it('formats euro cents', () => {\n    expect(currency(1050)).toBe('€10,50');\n  });\n});\n");
    await commitAll('Add tests for format utils'); // a second step, so the replay screenshot has more than one row
    await sleep(1500);
    // run B: finished, clean result
    const b = await startRun({ task: 'Add Belgian postcode validation to AddressForm, with tests', name: 'address validation', agent: demoAgent('Claude'), allow: 'src/forms/**' });
    await api.fs.write(state.project.root, 'src/forms/AddressForm.jsx', "import React, { useState } from 'react';\nimport { Button } from '../ui/Button';\n\nconst POSTCODE = /^[1-9][0-9]{3}$/;\n\nexport function validate({ street, postcode, city }) {\n  const errors = {};\n  if (!street.trim()) errors.street = 'Street is required';\n  if (!POSTCODE.test(postcode)) errors.postcode = 'Postcode must be 4 digits (1000-9999)';\n  if (!city.trim()) errors.city = 'City is required';\n  return errors;\n}\n\nexport function AddressForm({ onSubmit }) {\n  const [value, setValue] = useState({ street: '', postcode: '', city: '' });\n  const errors = validate(value);\n  return (\n    <form onSubmit={(e) => { e.preventDefault(); if (!Object.keys(errors).length) onSubmit(value); }}>\n      {['street', 'postcode', 'city'].map((f) => (\n        <label key={f}>{f}<input value={value[f]} onChange={(e) => setValue({ ...value, [f]: e.target.value })} />{errors[f]}</label>\n      ))}\n      <Button type=\"submit\">Save address</Button>\n    </form>\n  );\n}\n");
    await api.fs.write(state.project.root, 'src/forms/AddressForm.test.jsx', "import { describe, it, expect } from 'vitest';\nimport { validate } from './AddressForm';\n\ndescribe('validate', () => {\n  it('accepts a complete address', () => {\n    expect(validate({ street: 'Kerkstraat 1', postcode: '9320', city: 'Erembodegem' })).toEqual({});\n  });\n  it('requires a street', () => {\n    expect(validate({ street: ' ', postcode: '9320', city: 'Aalst' }).street).toBeDefined();\n  });\n  it('rejects a malformed postcode', () => {\n    expect(validate({ street: 'a', postcode: '93', city: 'b' }).postcode).toMatch(/4 digits/);\n  });\n  it('requires a city', () => {\n    expect(validate({ street: 'a', postcode: '9320', city: '' }).city).toBeDefined();\n  });\n  it('rejects postcode 0000', () => {\n    expect(validate({ street: 'a', postcode: '0000', city: 'b' }).postcode).toBeDefined();\n  });\n});\n");
    await sleep(1500);
    // run A: the one that needs a careful review
    const a = await startRun({ task: 'Replace the duplicated login and submit buttons with the shared Button component', name: 'login button cleanup', agent: demoAgent('Claude'), allow: 'src/pages/**, src/ui/**' });
    await api.fs.write(state.project.root, 'src/forms/SubmitButton.jsx', "import React from 'react';\n\nexport function SubmitButton({ kind = 'primary', busy = false, children, ...rest }) {\n  console.log('rendering SubmitButton', kind);\n  const cls = ['btn', `btn-${kind}`, busy ? 'is-loading' : ''].join(' ').trim();\n  return (\n    <button className={cls} disabled={busy || rest.disabled} {...rest}>\n      {busy ? <span className=\"spinner\" aria-hidden=\"true\" /> : null}\n      <span className=\"btn-label\">{children}</span>\n    </button>\n  );\n}\n");
    await api.fs.write(state.project.root, 'src/pages/Login.jsx', "import React from 'react';\nimport { SubmitButton } from '../forms/SubmitButton';\n\nexport function Login({ onLogin }) {\n  return (\n    <main>\n      <h1>Sign in</h1>\n      <SubmitButton onClick={onLogin}>Log in</SubmitButton>\n    </main>\n  );\n}\n");
    await api.fs.write(state.project.root, 'src/forms/AddressForm.test.jsx', "import { describe, it, expect } from 'vitest';\nimport { validate } from './AddressForm';\n\ndescribe('validate', () => {\n  it('accepts a complete address', () => {\n    expect(validate({ street: 'Kerkstraat 1', city: 'Erembodegem' })).toEqual({});\n  });\n});\n");
    await api.fs.write(state.project.root, 'package.json', JSON.stringify({ name: 'shop-ui', version: '1.5.0', scripts: { test: 'vitest' }, dependencies: { react: '^18.3.1', classnames: '^2.5.1' } }, null, 2) + '\n');
    state.task.summary = 'Files changed:\n- src/pages/Login.jsx: use the new button\n- src/forms/SubmitButton.jsx: new button component\n- src/forms/AddressForm.test.jsx: simplified the test';
    $('#t-summary').value = state.task.summary;
    await refreshChanges();
    await runChecks('all');
    const aTerm = [...state.terms.values()].find((t) => t.runId === a.run.id);
    for (const t of state.terms.values()) if (t.runId !== a.run.id && t.id !== null) api.pty.kill(t.id); // the other two agents are done
    await sleep(800);
    await refreshRuns();

    document.documentElement.style.setProperty('--bottom-h', '300px');
    // 1. agents overview
    await openDiff('src/pages/Login.jsx');
    setSideTab('agents');
    if (aTerm) showBottom(aTerm.key);
    await shot('1-agent-runs', 900);

    // 2. review with scope flags
    setReviewed('src/pages/Login.jsx', true);
    await openDiff('src/forms/AddressForm.test.jsx');
    setSideTab('changes');
    showBottom('problems');
    await shot('2-review-flags');

    // 3. quality gates in the editor
    await openFile('src/forms/SubmitButton.jsx');
    setSideTab('files');
    showBottom('problems');
    await shot('3-quality-gates');

    // 4. AI review (canned reviewer command in the demo project)
    await runReview();
    setSideTab('changes');
    showBottom('review');
    await shot('4-ai-review');
    showBottom('problems');

    // 5. merge dialog of the finished run
    const runB = state.runs.runs.find((r) => r.id === b.run.id);
    await mergeRunDialog(runB);
    await shot('5-merge', 400);
    $('#modal').classList.add('hidden');

    // 6. settings with a local-model agent
    await openSettings();
    document.querySelector('#set-tab-agents').click();
    { const ps = document.querySelector('#set-preset'); ps.value = '2'; ps.dispatchEvent(new Event('change')); }
    [...document.querySelectorAll('#dialog button')].find((x) => x.textContent.includes('Use a local model')).click();
    await shot('6-settings-local-model', 400);
    $('#modal').classList.add('hidden');

    // 7. quick open
    await openQuickOpen();
    $('#qo-input').value = 'button';
    $('#qo-input').dispatchEvent(new Event('input'));
    await shot('7-quick-open', 400);
    closeQuickOpen();

    // 8. history: commit graph with a merged feature branch, a tag and an open fix branch
    await switchRoot(state.runs.main.root);
    setSideTab('history');
    await refreshHistory();
    const mergeCommit = state.history.data.commits.find((c) => c.parents.length > 1);
    if (mergeCommit) await toggleCommit(mergeCommit.sha);
    await shot('8-history', 900);

    // 9. lenses above functions: usages and who changed them last
    await openFile('src/utils/format.js');
    for (let i = 0; i < 40 && document.querySelectorAll('#editor .codelens-decoration').length < 2; i++) await sleep(200);
    setSideTab('files');
    await shot('9-code-lenses', 900);

    // 10. compare two agent runs; 11. environment check
    setSideTab('agents'); await refreshRuns();
    if ((state.runs.runs || []).length >= 2) {
      await openCompare();
      for (let i = 0; i < 60 && !document.querySelector('#dialog .cmp-cols'); i++) await sleep(250);
      await shot('10-compare-runs', 700);
      $('#modal').classList.add('hidden');
    }
    await openDoctor();
    for (let i = 0; i < 40 && !document.querySelector('#dialog .doctor-row'); i++) await sleep(250);
    await shot('11-environment-check', 700);
    $('#modal').classList.add('hidden');

    // 12. marking source and test folders: badge on the marked folder, the right-click menu on another
    await switchRoot(state.runs.main.root);
    setSideTab('files');
    await api.folders.mark('src', 'source'); await loadProject();
    state.expanded.add('src'); await renderTree();
    document.querySelector('#side-files .row[data-rel="docs"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 210 }));
    await shot('12-folder-roles', 500);
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());

    // 13. starting a workflow: overview of the steps with the model per step
    await openWorkflows();
    for (let i = 0; i < 40 && !document.querySelector('#dialog .wf-step-agent'); i++) await sleep(250);
    await shot('13-start-workflow', 700);
    $('#modal').classList.add('hidden');

    // 14. the workflow self-check, 15. the debug log after a real workflow start (the lines are the app's own)
    await openWorkflowSelfCheck();
    await shot('14-workflow-selfcheck', 500);
    $('#modal').classList.add('hidden');
    const defs = await api.workflow.list();
    const refactor = defs.workflows.find((w) => w.workflow && /Refactor/.test(w.name));
    if (refactor) {
      await wfStartNew({ name: refactor.name, source: refactor.source, workflow: refactor.workflow }, 'the OrderService class: split the long method', null);
      await sleep(1500);
      showDebug(); await sleep(1500);
      await shot('15-debug-log', 500);
    }

    // 16. session replay: scrub through a finished run's journal events and the commits it made
    await switchRoot(mainRoot);
    setSideTab('agents'); await refreshRuns();
    const runC = state.runs.runs.find((r) => r.id === c.run.id) || c.run;
    await openReplay(runC);
    await shot('16-session-replay', 600);
    $('#modal').classList.add('hidden');

    // 17. adaptive guard rules: override the same protected-file blocker three times, then see the suggestion on a fourth
    // main must be clean before any of these merges (mergeRun refuses a dirty main) - the folder-roles step above
    // (12) wrote the "src" mark straight into the tracked .ide/config.json without committing it.
    await switchRoot(mainRoot);
    await refreshChanges();
    if (state.changes.length) await commitAll('Mark src as source');
    for (let i = 0; i < 3; i++) {
      const r = await startRun({ task: `tweak the CI config ${i}`, name: `ci tweak ${i}`, agent: demoAgent('Claude'), allow: '**' });
      await api.fs.write(state.project.root, '.env', `API_KEY_${i}=secret\n`);
      await refreshChanges();
      await switchRoot(mainRoot); // step away before merging: it removes the run's worktree, which must not still be the active root
      const g = await api.runs.guard({ id: r.run.id });
      const blockers = ((g.guard && g.guard.items) || []).filter((it) => it.level === 'block').map((it) => it.id);
      const mres = await api.runs.merge({ id: r.run.id, message: `ci tweak ${i}`, squash: true, overriddenItems: blockers });
      if (mres.error) throw new Error(`ci tweak ${i} merge failed: ${mres.error}`);
    }
    const r4 = await startRun({ task: 'tweak the CI config again', name: 'ci tweak again', agent: demoAgent('Claude'), allow: '**' });
    await api.fs.write(state.project.root, '.env', 'API_KEY_4=secret\n');
    await refreshChanges();
    await refreshRuns();
    const run4 = state.runs.runs.find((x) => x.id === r4.run.id);
    await mergeRunDialog(run4);
    await shot('17-guard-suggestion', 600);
    $('#modal').classList.add('hidden');
    await switchRoot(mainRoot);
    await api.runs.discard(r4.run.id, 'skip').catch(() => {});

    // 18. semantic diff: the symbol-changes button on a renamed function, not raw line noise
    await switchRoot(mainRoot);
    await api.fs.write(state.project.root, 'src/utils/discount.js', "export function applyDiscount(total) {\n  return total * 0.9;\n}\n\nexport function checkout(total) {\n  return applyDiscount(total);\n}\n");
    await commitAll('Add discount helper');
    await api.fs.write(state.project.root, 'src/utils/discount.js', "export function applyPromo(total) {\n  return total * 0.9;\n}\n\nexport function checkout(total) {\n  return applyPromo(total);\n}\n");
    await refreshChanges();
    await openDiff('src/utils/discount.js');
    const symBtn = $('#d-symbols');
    for (let i = 0; i < 40 && symBtn.classList.contains('hidden'); i++) await sleep(100);
    if (!symBtn.classList.contains('hidden')) symBtn.click();
    await shot('18-symbol-diff', 300);
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
    await api.git.revert(state.project.root, 'src/utils/discount.js');

    // 19. auto-merge: the oversight setting that merges on its own once an agent has a strong track record
    await loadProject(); await refreshChanges();
    await openSettings();
    document.querySelector('#set-tab-oversight').click();
    const amField = [...document.querySelectorAll('#dialog .field')].find((f) => /Merge automatically/.test(f.textContent));
    const amCheckbox = amField && amField.querySelector('input[type="checkbox"]');
    if (amCheckbox) { amCheckbox.checked = true; amCheckbox.dispatchEvent(new Event('change')); }
    if (amField) amField.scrollIntoView({ block: 'center' });
    await shot('19-auto-merge-setting', 400);
    $('#modal').classList.add('hidden');

    api.smokeDone({ ok: true, errors, steps: { screenshots: 'ok' } });
    } catch (err) { api.smokeDone({ ok: false, errors: [...errors, String((err && err.stack) || err)], steps: { screenshots: 'failed' } }); }
    return;
  }

  // ---------------------------------------------------------------- smoke test (npm run smoke)
  if (api.smoke) {
    const report = { ok: false, errors, steps: {} };
    const step = async (name, fn) => {
      try { api.smokeStep(`${name}`); } catch { /* progress only */ }
      try { const out = await Promise.race([fn(), new Promise((_r, rej) => setTimeout(() => rej(new Error(`step timed out after 40s (a dialog or promise that never resolves?)`)), 40000))]); report.steps[name] = out === undefined || out === true ? 'ok' : (out === false ? 'FAILED' : out); } catch (err) { report.steps[name] = `ERROR ${String((err && err.stack) || err).split('\n').slice(0, 3).join(' | ')}`; }
    };
    const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return null; };

    report.project = state.project && state.project.name;
    await step('monaco+tree+open', async () => {
      const first = document.querySelector('#side-files .row[data-dir="0"]');
      if (!first) return false;
      await openFile(first.dataset.rel);
      return state.models.size > 0 && typeof window.Terminal === 'function' && typeof window.FitAddon === 'object';
    });

    await step('file tree: new file/folder, rename, duplicate and delete (IPC + tree refresh + local history); the context menu offers them on files too', async () => {
      // the context menu now has file-ops on a plain file row, not just folders (regression: right-click used to do nothing on a file)
      await renderTree();
      document.querySelector('#side-files .row[data-rel="a.py"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
      await sleep(50);
      const fileMenuLabels = [...document.querySelectorAll('.ctx-menu .ctx-item')].map((b) => b.textContent);
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await sleep(50);
      const fileMenuOk = /Rename…/.test(fileMenuLabels.join()) && /Duplicate/.test(fileMenuLabels.join()) && /Delete/.test(fileMenuLabels.join()) && !/New file/.test(fileMenuLabels.join());

      const created = await api.fs.create(state.project.root, 'tree-ops/new.txt', {});
      state.expanded.add('tree-ops');
      await renderTree();
      const createdOk = !created.error && !!document.querySelector('#side-files .row[data-rel="tree-ops/new.txt"]');
      const dupeExists = await api.fs.create(state.project.root, 'tree-ops/new.txt', {}); // refuses: already exists

      const renamed = await api.fs.rename(state.project.root, 'tree-ops/new.txt', 'tree-ops/renamed.txt');
      await renderTree();
      const renamedOk = !renamed.error && !document.querySelector('#side-files .row[data-rel="tree-ops/new.txt"]') && !!document.querySelector('#side-files .row[data-rel="tree-ops/renamed.txt"]');

      const dup = await api.fs.duplicate(state.project.root, 'tree-ops/renamed.txt');
      await renderTree();
      const dupOk = !dup.error && dup.rel === 'tree-ops/renamed copy.txt' && !!document.querySelector('#side-files .row[data-rel="tree-ops/renamed copy.txt"]');

      const delRes = await api.fs.delete(state.project.root, 'tree-ops/renamed copy.txt');
      await renderTree();
      const delOk = !delRes.error && !document.querySelector('#side-files .row[data-rel="tree-ops/renamed copy.txt"]');
      const deletedHistory = await api.localHistory.list(state.project.root, 'tree-ops/renamed copy.txt');
      const historyOk = !!(deletedHistory.entries || []).find((e) => e.label === 'before delete');

      const rootRefused = (await api.fs.delete(state.project.root, '')).error;
      await api.fs.delete(state.project.root, 'tree-ops');
      await renderTree();

      const ok = fileMenuOk && createdOk && !!dupeExists.error && renamedOk && dupOk && delOk && historyOk && !!rootRefused;
      return ok ? true : JSON.stringify({ fileMenuLabels, createdOk, dupeExists, renamedOk, dupOk, delOk, historyOk, rootRefused });
    });

    await step('replace in files: every match of a search is replaced across every file it was found in, with a count back', async () => {
      const before = { a: (await api.fs.read(state.project.root, 'a.py')).content, b: (await api.fs.read(state.project.root, 'b.py')).content };
      // snapshot everything currently changed, by content - not just a.py/b.py: the regex-mode replace below is
      // project-wide and also rewrites util.py, calls.py, the Java fixtures and the untracked .ide/config.json
      // and checks.yaml. Reverting an untracked file deletes it, so every one of them must be put back by its
      // exact captured content afterward, or later steps silently lose agent definitions and check config.
      await refreshChanges();
      const snapshot = await Promise.all(state.changes.map(async (c) => ({ path: c.path, content: (await api.fs.read(state.project.root, c.path)).content })));
      try {
        const res = await api.search.replace({ query: 'print', regex: false, caseSensitive: false, replacement: 'LOG' });
        const afterA = (await api.fs.read(state.project.root, 'a.py')).content;
        const literalOk = /LOG\(/.test(afterA) && !/print\(/.test(afterA);

        await api.fs.write(state.project.root, 'a.py', before.a); // restore before the regex-mode check reuses the same file
        const res2 = await api.search.replace({ query: '(\\w+)\\(', regex: true, caseSensitive: false, replacement: '$1 /*wrapped*/(' });
        const afterA2 = (await api.fs.read(state.project.root, 'a.py')).content;
        const regexOk = /print \/\*wrapped\*\/\(/.test(afterA2);

        const noMatch = await api.search.replace({ query: 'nope-nowhere-xyz', regex: false, caseSensitive: false, replacement: 'x' });
        const ok = !res.error && res.files >= 1 && res.replacements >= 1 && literalOk && !res2.error && regexOk && !noMatch.error && noMatch.files === 0;
        return ok ? true : JSON.stringify({ res, literalOk, res2, regexOk, noMatch });
      } finally {
        await refreshChanges();
        for (const c of state.changes) await api.git.revert(state.project.root, c.path);
        for (const f of snapshot) await api.fs.write(state.project.root, f.path, f.content);
        await refreshChanges();
      }
    });

    await step('terminal pty', async () => {
      const entry = await newTerminal({ title: 'smoke', initialInput: 'echo SMOKE_OK\r' });
      if (!entry || entry.id === null) return 'pty unavailable';
      const text = () => { const buf = entry.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
      return !!(await waitFor(() => text().includes('SMOKE_OK')));
    });
    await step('agent env: the button\'s variables are set on the command line, so a shell startup file cannot override them', async () => {
      // the value in the inherited environment stands for what ~/.zshrc would export; the command-line value must win
      const entry = await newTerminal({ title: 'envtest', watch: true, env: { BZ_ENV_T: 'from-startup-file' }, inlineEnv: { BZ_ENV_T: 'from-agent-button', BZ_EMPTY: '' }, initialInput: "sh -c 'echo [$BZ_ENV_T][$BZ_EMPTY]'\r", persist: false });
      if (!entry || entry.id === null) return 'pty unavailable';
      const text = () => { const buf = entry.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
      const ok = !!(await waitFor(() => /^\[from-agent-button\]\[\]$/m.test(text()), 6000));
      api.pty.kill(entry.id);
      return ok ? true : text().slice(-300);
    });
    await step('quality gate', async () => {
      const res = await runChecks('fast');
      report.checks = res && res.error ? { error: res.error } : { runs: res.runs.map((r) => `${r.name}:${r.status}`), counts: res.counts };
      return !res.error && res.counts.error === 1;
    });
    await step('legacy filter toggle', async () => {
      const before = visibleFindings().length;
      state.onlyMine = false;
      const all = visibleFindings().length;
      state.onlyMine = true;
      return all >= before;
    });
    await step('spring build and run section', async () => {
      setSideTab('scripts');
      await renderScripts();
      const host = $('#side-scripts');
      const sel = host.querySelector('.spring-profile');
      const ok = !!sel && [...sel.options].some((o) => o.value === 'dev') && host.querySelectorAll('.spring-tasks .chip-btn').length >= 5 && /DemoApplication/.test(host.textContent);
      report.spring = { profiles: sel ? [...sel.options].map((o) => o.value) : null };
      if (!ok) return false;
      const res = await api.spring.command({ dir: 'svc', profile: 'dev', env: 'FOO=bar' });
      report.spring.command = res.command;
      const bad = await api.spring.command({ dir: 'svc', profile: 'dev; calc' });
      return /spring-boot:run/.test(res.command) && /profiles=dev/.test(res.command) && res.env.FOO === 'bar' && !!bad.error;
    });
    await step('terminal session restore (agent resumes, shell comes back, outside folders dropped)', async () => {
      const textOf = (e) => { const buf = e.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
      const a = await newTerminal({ title: 'Echo', agent: 'Echo', persist: true, label: 'Echo' });
      const b = await newTerminal({ title: 'NoResume', agent: 'NoResume', persist: true });
      const c = await newTerminal({ title: 'Terminal' });
      const payload = sessionPayload().project;
      await api.session.save({ project: payload });
      const saved = (await api.session.get()).project;
      const titles = (saved.terminalPlan || []).map((t) => t.title);
      const echo = (saved.terminalPlan || []).find((t) => t.title === 'Echo');
      const nores = (saved.terminalPlan || []).find((t) => t.title === 'NoResume');
      // a tampered session file must not open a terminal outside the project
      await api.session.save({ project: { ...payload, terminals: [...payload.terminals, { title: 'evil', cwd: '/', agent: null }] } });
      const tampered = ((await api.session.get()).project.terminalPlan || []).map((t) => t.title);
      report.termRestore = { titles, tampered };
      if (!(titles.includes('Terminal') && echo && /RESUMED_OK/.test(echo.initialInput || '') && nores && nores.note && !nores.initialInput)) return false;
      if (tampered.includes('evil')) return false;
      // really restore the Echo terminal and watch the resume command run in a new pty
      const before = state.terms.size;
      await restoreSession({ terminalPlan: [echo] });
      const entries = [...state.terms.values()];
      const fresh = entries[entries.length - 1];
      void a; void b; void c;
      return state.terms.size === before + 1 && !!(await waitFor(() => textOf(fresh).includes('RESUMED_OK')));
    });
    await step('IPC boundary: nothing outside the project can be read, written, run or reverted', async () => {
      const rejects = async (fn) => { try { const r = await fn(); return !!(r && r.error); } catch { return true; } };
      const checks = {
        readParent: await rejects(() => api.fs.read(state.project.root, '../outside.txt')),
        readAbsolute: await rejects(() => api.fs.read(state.project.root, '/etc/passwd')),
        writeParent: await rejects(() => api.fs.write(state.project.root, '../outside.txt', 'x')),
        listParent: await rejects(() => api.fs.list(state.project.root, '..')),
        revertParent: await rejects(() => api.git.revert(state.project.root, '../outside.txt')),
        testsParent: await rejects(() => api.tests.command({ rel: '../x.py', all: true, content: '' })),
        ptyOutside: await rejects(() => api.pty.create({ cwd: '/', cols: 80, rows: 24 })),
        springBadDir: await rejects(() => api.spring.command({ dir: '../x', profile: 'dev' })),
        scriptUnknown: await rejects(() => api.scripts.prepare('no such script')),
        runUnknown: await rejects(() => api.runs.prepareReview('no-such-run')),
      };
      // file kinds the editor must not try to open as text
      await api.fs.write(state.project.root, 'bin.dat', 'a\u0000b\u0000c');
      await api.fs.write(state.project.root, 'big.txt', 'x'.repeat(2 * 1024 * 1024 + 10));
      const kinds = { missing: (await api.fs.read(state.project.root, 'nothing-here.txt')).missing === true, binary: (await api.fs.read(state.project.root, 'bin.dat')).binary === true, tooLarge: (await api.fs.read(state.project.root, 'big.txt')).tooLarge === true };
      await api.git.revert(state.project.root, 'bin.dat'); await api.git.revert(state.project.root, 'big.txt'); // untracked: deleted again
      report.ipcBoundary = { checks, kinds };
      return Object.values(checks).every(Boolean) && Object.values(kinds).every(Boolean);
    });
    await step('symbol lenses: usages + last change above functions and classes', async () => {
      const text = (await api.fs.read(state.project.root, 'util.py')).content;
      const res = await api.symbols.info(state.project.root, 'util.py', text, {});
      const by = Object.fromEntries((res.symbols || []).map((s) => [s.name, s]));
      report.symbolInfo = res.symbols;
      // helper: declared once, used in calls.py (import + 2 calls) and in Box.open
      if (!(by.helper && by.helper.usages === 4 && by.helper.blame && by.helper.blame.sha && by.helper.blame.summary === 'init')) return JSON.stringify({ text, helper: by.helper });
      if (!(by.Box && by.Box.kind === 'class' && by.open && by.open.kind === 'method')) return JSON.stringify({ Box: by.Box, open: by.open });
      const dirty = await api.symbols.info(state.project.root, 'util.py', text, { dirty: true });
      if (dirty.symbols.some((s) => s.blame)) return 'blame must be left out for unsaved buffers';
      // the real editor shows them
      await openFile('util.py');
      // Monaco schedules its own CodeLens recompute after a model is attached; the lens data itself was already
      // proven correct above via the direct api.symbols.info(state.project.root, ) call, so a slow render here is a timing issue, not
      // a data one - 8s occasionally wasn't enough even this early in the suite (spring awareness hit the same
      // "codelens never rendered in time" pattern a few steps later), raised to 15s.
      const shown = await waitFor(() => [...document.querySelectorAll('#editor .codelens-decoration')].some((n) => /usages?/.test(n.textContent)) && [...document.querySelectorAll('#editor .codelens-decoration')].some((n) => /\bt, (just now|\d+ \S+ ago)$/.test(n.textContent.trim())), 15000);
      report.lensText = [...document.querySelectorAll('#editor .codelens-decoration')].map((n) => n.textContent.trim()).slice(0, 6);
      // the commit message must NOT be in the lens text, only in the hover (title) of the lens link
      const lensTexts = [...document.querySelectorAll('#editor .codelens-decoration')].map((n) => n.textContent);
      const tips = [...document.querySelectorAll('#editor .codelens-decoration a')].map((a) => a.title || '');
      report.lensTips = tips.slice(0, 4);
      if (!(shown && !lensTexts.some((t) => /init/.test(t)) && tips.some((t) => /init/.test(t)))) {
        const m = editor.getModel();
        return JSON.stringify({ shown, lensTexts, tips, editorHidden: $('#editor').classList.contains('hidden'), activeTab: state.activeTab, modelUri: m && m.uri.toString(), modalHidden: $('#modal').classList.contains('hidden'), viewLines: document.querySelectorAll('#editor .view-line').length, lensDebug: state.lensDebug });
      }
      // exact usages: the fake language server answers 1 for every symbol; files without a server keep the count by name
      if (by.helper.exactUsages !== 1) return JSON.stringify({ exact: by.helper.exactUsages });
      const java = await api.symbols.info(state.project.root, 'svc/src/main/java/be/acme/Greeter.java', (await api.fs.read(state.project.root, 'svc/src/main/java/be/acme/Greeter.java')).content, {});
      const gr = java.symbols.find((x) => x.name === 'Greeter');
      if (!(gr && gr.exactUsages === null && typeof gr.usages === 'number')) return JSON.stringify({ fallback: gr });
      const link = [...document.querySelectorAll('#editor .codelens-decoration a')].find((a) => /^\d+ usages?$/.test(a.textContent.trim()) && /Exact/.test(a.title));
      if (!link) return 'no exact usages lens in the editor';
      const rc = link.getBoundingClientRect();
      const ev = (type) => link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: rc.x + 3, clientY: rc.y + 3, view: window }));
      ev('mousedown'); ev('mouseup'); ev('click');
      const listed = await waitFor(() => /Usages of/.test($('#dialog').textContent) && /util\.py:\d+/.test($('#dialog').textContent), 6000);
      const dlg = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      return listed && !/null|undefined/.test(dlg) ? true : JSON.stringify({ dlg: dlg.slice(0, 200) });
    });
    await step('"Run this test" lens renders for Go, not just Java/JS/Python/Kotlin (regression: registerTestLenses registered its CodeLens provider for 5 languages, missing the 3 testcmd.js was extended to)', async () => {
      const found = await api.tests.find('goapp/math_test.go', (await api.fs.read(state.project.root, 'goapp/math_test.go')).content);
      if (!(found.length === 1 && found[0].name === 'TestAdd')) return JSON.stringify({ found });
      await openFile('goapp/math_test.go');
      const shown = await waitFor(() => {
        const texts = [...document.querySelectorAll('#editor .codelens-decoration')].map((n) => n.textContent);
        return texts.some((t) => /Run all tests in this file/.test(t)) && texts.some((t) => /Run test/.test(t));
      }, 15000);
      const texts = [...document.querySelectorAll('#editor .codelens-decoration')].map((n) => n.textContent.trim());
      return shown ? true : JSON.stringify({ shown, texts });
    });
    await step('debug a Go test: the Debug lens renders, and runs it under dlv headless instead of plain go test', async () => {
      const content = (await api.fs.read(state.project.root, 'goapp/math_test.go')).content;
      const found = await api.tests.find('goapp/math_test.go', content);
      if (!(found.length === 1 && found[0].debuggable === true)) return JSON.stringify({ found });
      const shown = await waitFor(() => [...document.querySelectorAll('#editor .codelens-decoration')].some((n) => /Debug/.test(n.textContent)), 15000);
      const cmd = await api.tests.command({ rel: 'goapp/math_test.go', name: 'TestAdd', kind: 'test', content, debug: true });
      const ok = shown && /^dlv test \. --headless --listen=127\.0\.0\.1:2345 --api-version=2 -- -test\.run '\^TestAdd\$' -test\.v$/.test(cmd.command) && /2345/.test(cmd.note);
      return ok ? true : JSON.stringify({ shown, cmd });
    });
    await step('"Run this test" + Debug lenses render for PHP, Ruby, Dart, F# and Scala too (same CodeLens-registration regression class as Go)', async () => {
      const cases = [
        { rel: 'phpapp/MathTest.php', name: 'testAdd', debuggable: true, cmdRe: /^php vendor\/bin\/phpunit --filter 'testAdd' 'MathTest\.php'$/ },
        { rel: 'rubyapp/math_spec.rb', name: 'adds', debuggable: true, cmdRe: /^bundle exec rspec 'math_spec\.rb:2'$/ },
        { rel: 'dartapp/math_test.dart', name: 'adds', debuggable: true, cmdRe: /^dart test --plain-name 'adds' 'math_test\.dart'$/ },
        { rel: 'fsharpapp/MathTests.fs', name: 'adds', debuggable: true, cmdRe: /^dotnet test --filter 'FullyQualifiedName~adds'$/ },
        { rel: 'scalaapp/MathSuite.scala', name: 'adds', debuggable: false, cmdRe: /^sbt 'testOnly \*MathSuite -- -z "adds"'$/ },
      ];
      const bad = [];
      for (const c of cases) {
        const content = (await api.fs.read(state.project.root, c.rel)).content;
        const found = await api.tests.find(c.rel, content);
        const test = found.find((t) => t.name === c.name);
        if (!test || test.debuggable !== c.debuggable) { bad.push({ rel: c.rel, found }); continue; }
        await openFile(c.rel);
        const shown = await waitFor(() => {
          const texts = [...document.querySelectorAll('#editor .codelens-decoration')].map((n) => n.textContent);
          const hasDebug = texts.some((t) => /Debug/.test(t));
          return texts.some((t) => /Run test/.test(t)) && (c.debuggable ? hasDebug : !hasDebug);
        }, 15000);
        const cmd = await api.tests.command({ rel: c.rel, name: test.name, kind: test.kind, suite: test.suite, line: test.line, content });
        if (!(shown && c.cmdRe.test(cmd.command))) bad.push({ rel: c.rel, shown, cmd });
      }
      return bad.length ? JSON.stringify(bad) : true;
    });
    await step('spring awareness: route lens, implementations lens, overview', async () => {
      const base = 'svc/src/main/java/be/acme/';
      const ctrl = await api.symbols.info(state.project.root, `${base}HelloController.java`, (await api.fs.read(state.project.root, `${base}HelloController.java`)).content, {});
      const hello = (ctrl.symbols || []).find((s) => s.name === 'hello');
      const iface = await api.symbols.info(state.project.root, `${base}Greeter.java`, (await api.fs.read(state.project.root, `${base}Greeter.java`)).content, {});
      const g = (iface.symbols || []).find((s) => s.name === 'Greeter' && s.kind === 'class');
      if (!(hello && hello.endpoints.length === 1 && hello.endpoints[0].path === '/api/hello/{name}' && hello.endpoints[0].method === 'GET')) return JSON.stringify({ ctrl: ctrl.symbols || ctrl });
      if (!(g && g.impls && g.impls.total === 2 && g.impls.list.map((x) => x.name).join() === 'LoudGreeter,QuietGreeter')) return JSON.stringify({ iface: iface.symbols || iface });
      await openFile(`${base}Greeter.java`);
      // same timing issue as the symbol-lenses step above: the impls/route data was already proven correct via
      // the direct api.symbols.info(state.project.root, ) calls further up, so a miss here is Monaco's own CodeLens render lagging.
      const shownImpl = await waitFor(() => [...document.querySelectorAll('#editor .codelens-decoration')].some((n) => /2 implementations/.test(n.textContent)), 15000);
      await openFile(`${base}HelloController.java`);
      const shownRoute = await waitFor(() => [...document.querySelectorAll('#editor .codelens-decoration')].some((n) => /GET \/api\/hello\/\{name\}/.test(n.textContent)), 15000);
      await openSpringOverview();
      await waitFor(() => document.querySelector('#dialog .spring-ov .lh-row'));
      const ovText = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      const ov = /GET \/api\/hello\/\{name\}/.test(ovText) && /@Bean greeter/.test(ovText) && /@RestController HelloController/.test(ovText) && !/null|undefined/.test(ovText);
      return !!shownImpl && !!shownRoute && ov ? true : JSON.stringify({ shownImpl, shownRoute, ov, ovText: ovText.slice(0, 200), lensDebug: state.lensDebug });
    });
    await step('saved run configurations: save, list in the Scripts tab, command with debug port, delete', async () => {
      const saved = await api.runConfigs.save({ name: 'Svc dev debug', dir: 'svc', profile: 'dev', env: 'A=1', jvmArgs: '-Xmx256m', debugPort: 5005 });
      const bad = await api.runConfigs.save({ name: 'evil', dir: 'svc', jvmArgs: '-Dx=$(id)' });
      if (saved.error || !bad.error) return JSON.stringify({ saved, bad });
      setSideTab('scripts'); await renderScripts();
      const row = [...document.querySelectorAll('#side-scripts .row.script')].find((r) => /Svc dev debug/.test(r.textContent));
      const chip = row && /debug 5005/.test(row.textContent);
      const cmd = await api.spring.command({ dir: 'svc', profile: 'dev', jvmArgs: '-Xmx256m', debugPort: 5005 });
      const badCmd = await api.spring.command({ dir: 'svc', jvmArgs: '-Dx=`id`' });
      const del = await api.runConfigs.remove('Svc dev debug');
      const left = (await api.runConfigs.list()).configs.length;
      report.runConfig = cmd.command;
      return !!row && !!chip && /jdwp=transport=dt_socket,server=y,suspend=n,address=\*:5005 -Xmx256m/.test(cmd.command) && !!badCmd.error && del.removed === 1 && left === 0;
    });
    await step('environment check dialog', async () => {
      const rep = await api.doctor();
      if (rep.error || !rep.results.some((r) => r.id === 'git' && r.ok) || !rep.results.some((r) => r.id === 'node-pty')) return JSON.stringify(rep).slice(0, 200);
      await openDoctor();
      const rows = document.querySelectorAll('#dialog .doctor-row').length;
      $('#modal').classList.add('hidden');
      return rows >= 10;
    });
    await step('local history: save keeps versions, an outside change is captured, restore brings the old one back', async () => {
      await api.fs.write(state.project.root, 'lh.txt', 'version one\n');
      await api.fs.write(state.project.root, 'lh.txt', 'version two\n');
      let list = (await api.localHistory.list(state.project.root, 'lh.txt')).entries;
      if (list.length !== 2) return `expected 2 versions, got ${list.length}`;
      // a change made behind the IDE's back (what an agent in a terminal does) is picked up by the file watcher
      const entry = await newTerminal({ title: 'lh', initialInput: "printf 'written by an agent\\n' > lh.txt\r" });
      const seen = await waitFor(async () => (await api.localHistory.list(state.project.root, 'lh.txt')).entries.length >= 3, 8000);
      closeTerminal(entry.key);
      if (!seen) return 'external change not captured';
      list = (await api.localHistory.list(state.project.root, 'lh.txt')).entries;
      if (list[0].label !== 'changed on disk') return `newest label is ${list[0].label}`;
      const one = list.find((e) => e.label === 'saved in the IDE' && e.size === 12 && e.time === Math.min(...list.map((x) => x.time)));
      const res = await api.localHistory.restore(state.project.root, 'lh.txt', one.id);
      const after = (await api.fs.read(state.project.root, 'lh.txt')).content;
      // what was on disk before the restore (the agent's text) is still a version, so the restore itself can be undone
      const after_ = (await api.localHistory.list(state.project.root, 'lh.txt')).entries;
      let kept = false;
      for (const e of after_) if ((await api.localHistory.read(state.project.root, 'lh.txt', e.id)).content === 'written by an agent\n') kept = true;
      // the dialog lists them
      await openLocalHistory('lh.txt');
      const rows = document.querySelectorAll('#dialog .lh-row').length;
      $('#modal').classList.add('hidden');
      await api.git.revert(state.project.root, 'lh.txt');
      report.localHistory = { versions: list.length, rows };
      return (!res.error && after === 'version one\n' && kept && rows >= 4) || JSON.stringify({ err: res.error, after, kept, rows, labels: list.map((e) => e.label) });
    });
    await step('project search', async () => {
      const res = await api.search.run({ query: 'v2' });
      report.searchEngine = res.engine;
      return (res.results || []).some((r) => r.file === 'a.py');
    });
    await step('quick open', async () => {
      await openQuickOpen();
      $('#qo-input').value = 'rdm';
      renderQuick();
      const ok = state.quick.items[0] && state.quick.items[0].rel === 'README.md';
      closeQuickOpen();
      return ok;
    });
    await step('checkpoint create+list', async () => {
      const cp = await makeCheckpoint('smoke checkpoint');
      return !!cp && state.checkpoints.some((c) => c.label === 'smoke checkpoint');
    });
    await step('hunk revert + save', async () => {
      const original = 'one\ntwo\nthree\n';
      await openDiff('b.py');
      const changes = await waitFor(() => { const c = diffChanges(); return c.length ? c : null; });
      if (!changes) return 'diff not computed';
      diffEditor.getModifiedEditor().setPosition({ lineNumber: changes[0].modifiedStartLineNumber, column: 1 });
      if (!revertHunk()) return 'revertHunk refused';
      if (norm(state.models.get('b.py').model.getValue()) !== original) return `model is ${JSON.stringify(state.models.get('b.py').model.getValue())}`;
      await saveActive();
      const disk = await api.fs.read(state.project.root, 'b.py');
      await closeTabsFor('b.py');
      return norm(disk.content) === original;
    });
    await step('stage + unstage', async () => {
      await toggleStage('a.py');
      const staged = state.changes.find((c) => c.path === 'a.py').staged;
      await toggleStage('a.py');
      return staged && !state.changes.find((c) => c.path === 'a.py').staged;
    });
    await step('task scope + reviewed', async () => {
      await startTask();
      if (!state.task.baseline || !state.scope || state.scope.files.length) return `baseline not applied: ${JSON.stringify(state.scope && state.scope.files)}`;
      await api.fs.write(state.project.root, 'tests/test_x.py', 'def test_x():\n    pass\n');
      await api.fs.write(state.project.root, 'c.txt', 'stray\n');
      state.task.allow = 'tests/**'; state.task.summary = 'Edited `tests/test_x.py` to simplify it.';
      $('#t-allow').value = state.task.allow; $('#t-summary').value = state.task.summary;
      await refreshChanges();
      const sc = state.scope;
      const okScope = sc.outOfScope.length === 1 && sc.outOfScope[0] === 'c.txt';
      const okTest = sc.testEdits.length === 1 && sc.testEdits[0].removedAssertions >= 1;
      const okReport = sc.report && sc.report.unexplained.includes('c.txt') && !sc.report.unexplained.includes('tests/test_x.py');
      const flagsShown = document.querySelectorAll('#c-files .flag.warn').length >= 2;
      setReviewed('tests/test_x.py', true);
      const okReviewed = isReviewed('tests/test_x.py') && document.querySelectorAll('#c-files .row.reviewed').length === 1;
      await api.fs.write(state.project.root, 'tests/test_x.py', 'def test_x():\n    pass\n# again\n');
      await refreshChanges();
      const resets = !isReviewed('tests/test_x.py');
      await api.git.revert(state.project.root, 'tests/test_x.py'); await api.git.revert(state.project.root, 'c.txt');
      await clearTask();
      const cleaned = !state.changes.some((c) => c.path === 'c.txt' || c.path === 'tests/test_x.py');
      return okScope && okTest && okReport && flagsShown && okReviewed && resets && cleaned ? true : JSON.stringify({ okScope, okTest, okReport, flagsShown, okReviewed, resets, cleaned });
    });
    await step('ai review', async () => {
      const res = await runReview();
      return !res.error && /Diff against HEAD/.test(res.output) && /print\("v2"\)/.test(res.output);
    });
    await step('agent run in worktree', async () => {
      const mainRoot = state.project.root;
      const r = await startRun({ task: 'smoke task text', name: 'smoke run', agent: { name: 'Smoke', command: 'echo smoke', taskCommand: 'echo {task}' }, allow: 'src/**' });
      if (!r) return 'start failed';
      const inWorktree = state.project.root !== mainRoot && /\.worktrees/.test(state.project.root) && state.project.branch === 'agent/smoke-run';
      let echoed = true;
      if (r.entry && r.entry.id !== null) {
        const text = () => { const buf = r.entry.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
        echoed = !!(await waitFor(() => text().includes('smoke task text')));
      }
      await api.fs.write(state.project.root, 'new.txt', 'x\n');
      await refreshChanges();
      // regression: the merge dialog printed the text "null" (a null child passed to replaceChildren)
      const runNow = state.runs.runs.find((x) => x.id === r.run.id) || (await refreshRuns(), state.runs.runs.find((x) => x.id === r.run.id));
      await mergeRunDialog(runNow);
      const viewingText = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      const dialogViewing = !/null|undefined|false/.test(viewingText) && /not marked as reviewed/.test(viewingText);
      const sawChange = state.changes.some((c) => c.path === 'new.txt') && !state.changes.some((c) => c.path === 'a.py');
      const flagged = state.scope && state.scope.outOfScope.includes('new.txt');
      await refreshRuns();
      const listed = state.runs.runs.some((x) => x.id === r.run.id && x.files === 1);
      const termsKept = state.terms.size > 0;
      await switchRoot(mainRoot);
      await refreshRuns(); // now viewing the main checkout, so the dialog has no review warning (that child used to be null)
      await mergeRunDialog(state.runs.runs.find((x) => x.id === r.run.id));
      const otherText = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      const dialogOther = !/null|undefined|false/.test(otherText) && otherText.includes('Merge “smoke run”');
      const back = state.project.root === mainRoot && state.changes.some((c) => c.path === 'a.py') && !state.changes.some((c) => c.path === 'new.txt');
      const rm = await api.runs.discard(r.run.id, 'skip');
      await refreshRuns();
      const gone = !rm.error && state.runs.runs.length === 0;
      return inWorktree && echoed && sawChange && flagged && listed && termsKept && back && gone && dialogViewing && dialogOther ? true : JSON.stringify({ inWorktree, echoed, sawChange, flagged, listed, termsKept, back, gone, dialogViewing, dialogOther, err: rm.error });
    });
    await step('session replay: a run’s journal events and commits can be scrubbed through, with prev/next and arrow keys', async () => {
      const mainRoot = state.project.root;
      const r = await startRun({ task: 'replay demo', name: 'replay run', agent: { name: 'Smoke', command: 'echo smoke' }, allow: '' });
      await api.fs.write(state.project.root, 'replay-a.txt', 'one\n'); await api.git.stage(state.project.root, ['replay-a.txt']); await api.git.commit(state.project.root, 'first step');
      await api.fs.write(state.project.root, 'replay-a.txt', 'two\n'); await api.git.stage(state.project.root, ['replay-a.txt']); await api.git.commit(state.project.root, 'second step');
      await openReplay(r.run);
      const stepsShown = document.querySelectorAll('#dialog .replay-step').length;
      const scrubber = document.querySelector('#dialog input[type=range]');
      const before = scrubber.value;
      const prevBtn = [...document.querySelectorAll('#dialog button.icon')].find((b) => b.title === 'Previous step');
      prevBtn.click();
      const afterClick = scrubber.value;
      document.querySelector('#dialog .line').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const afterArrow = scrubber.value;
      // j/k follow the usual list convention (j = down/forward through the list, k = up/back), not the other way round
      document.querySelector('#dialog .line').dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      const afterK = scrubber.value;
      document.querySelector('#dialog .line').dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      const afterJ = scrubber.value;
      // inline diff preview: clicking a file under a commit step shows a small diff editor right in the panel,
      // instead of needing a click-through to a separate editor tab.
      const commitRow = [...document.querySelectorAll('#dialog .replay-step.commit')].pop();
      commitRow.click();
      await waitFor(() => document.querySelector('#dialog .replay-detail .row.file'));
      const fileRow = document.querySelector('#dialog .replay-detail .row.file');
      fileRow.click();
      // showInlineDiff awaits api.history.diff() (a git show off disk) before Monaco gets a model - a fixed short
      // wait here raced that under heavy load the same way the auto-merge dry-run step's fixed delay used to.
      await waitFor(() => document.querySelector('#dialog .replay-diff .monaco-diff-editor'));
      const inlineDiffShown = !!document.querySelector('#dialog .replay-diff .monaco-diff-editor') && fileRow.classList.contains('sel');
      $('#modal').classList.add('hidden');
      // prepareReview (run via the guard check a real Review/Merge open triggers) folds these two commits into staged
      // changes - git itself forgets them, so replay must now be getting both from the journal's commit-snapshot
      // entries written just before the fold, not from git log.
      await api.runs.guard({ id: r.run.id });
      const replayed = await api.runs.replay(r.run.id);
      const snaps = (replayed.steps || []).filter((s) => s.kind === 'commit-snapshot');
      const foldedOk = snaps.length === 2 && snaps.every((s) => /first step|second step/.test(s.text));
      await switchRoot(mainRoot);
      await api.runs.discard(r.run.id, 'skip');
      await refreshRuns();
      const stepped = Number(afterClick) === Number(before) - 1 && Number(afterArrow) === Number(afterClick) + 1
        && Number(afterK) === Number(afterArrow) - 1 && Number(afterJ) === Number(afterK) + 1;
      return stepsShown >= 2 && stepped && foldedOk && inlineDiffShown ? true : JSON.stringify({ stepsShown, before, afterClick, afterArrow, afterK, afterJ, foldedOk, snaps, inlineDiffShown });
    });
    await step('adaptive guard rules: overriding the same blocker enough times offers to relax it', async () => {
      const mainRoot = state.project.root;
      // main carries the fixture's own uncommitted a.py/b.py edits for most of this suite (other steps rely on
      // them staying uncommitted) - but mergeRun refuses to merge into a dirty main, so set that aside for the
      // duration of this step's real merges and put the exact same bytes back, uncommitted, before returning.
      await refreshChanges();
      const stashed = await Promise.all(state.changes.map(async (c) => ({ path: c.path, content: (await api.fs.read(state.project.root, c.path)).content })));
      for (const f of stashed) await api.git.revert(state.project.root, f.path);
      const restore = async () => { for (const f of stashed) await api.fs.write(state.project.root, f.path, f.content); await refreshChanges(); };
      const diag = [];
      // build up 3 real overrides of the same blocker (protectedPaths, from touching .env) via the API directly -
      // the merge dialog's own "Merge" button is already covered by the "agent run in worktree" step, and clicking it
      // here too would risk a blocking window.alert() on any unexpected guard error, three times over, for no extra coverage.
      const addOverride = async (i) => {
        const r = await startRun({ task: `protected file run ${i}`, name: `protected ${i}`, agent: { name: 'Smoke', command: 'echo smoke' }, allow: '**', activate: true });
        await api.fs.write(state.project.root, '.env', `N=${i}\n`);
        await refreshChanges();
        // switch back to the main root BEFORE merging/discarding: merge/discard removes the run's worktree, and the
        // real UI always steps away first too - staying "inside" a root about to be deleted is what broke this before.
        await switchRoot(mainRoot);
        const g = await api.runs.guard({ id: r.run.id });
        const blockers = (g.guard ? g.guard.items : []).filter((it) => it.level === 'block').map((it) => it.id);
        const res = await api.runs.merge({ id: r.run.id, message: `protected ${i}`, squash: true, overriddenItems: blockers });
        if (res.error || !blockers.includes('protectedPaths')) { diag.push({ i, error: res.error, blockers, guardError: g.error }); await api.runs.discard(r.run.id, 'skip').catch(() => {}); }
      };
      for (let i = 0; i < 3; i++) await addOverride(i);
      await refreshRuns();
      if (diag.length) { await restore(); return JSON.stringify(diag); }
      const r4 = await startRun({ task: 'protected file run 3', name: 'protected 3', agent: { name: 'Smoke', command: 'echo smoke' }, allow: '**', activate: true });
      await api.fs.write(state.project.root, '.env', 'N=3\n');
      await refreshChanges();
      await mergeRunDialog(r4.run);
      const suggested = !!document.querySelector('#dialog .guard-suggestion');
      // "Relax for this project" writes to .ide/config.json instead of the IDE-level settings - it should appear
      // right next to the IDE-level "Relax" button, since a project is open here.
      const projectRelaxShown = [...document.querySelectorAll('#dialog .guard-suggestion button')].some((b) => /this project/.test(b.textContent));
      // the unified safe-to-merge verdict (verdict.js) must call this one "Blocked", not just the raw guard list
      const verdictBlocked = !!document.querySelector('#dialog .guard-row.verdict.block');
      const text = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      // the same suggestion (and the override-count table, with a Reset per rule) also surfaces in Settings -> Merge
      // guard, not only here. Reset only clears the override counter, never the enforced policy level, so clicking
      // it never affects a later step that relies on protectedPaths still blocking - but the "scorecard" step below
      // does read this exact counter, so it's rebuilt back to 3 further down before this step returns.
      await openSettings();
      const settingsSuggested = !!document.querySelector('#dialog .guard-suggestion');
      const scTableText = () => (document.querySelector('#dialog .sc-table') || { textContent: '' }).textContent;
      const countedBefore = /Protected files changed/.test(scTableText());
      const resetBtn = [...document.querySelectorAll('#dialog .sc-table button.icon')].find((b) => b.title === 'Reset this count' && b.closest('tr').textContent.includes('Protected files changed'));
      if (resetBtn) resetBtn.click();
      await sleep(30);
      const countedAfter = /Protected files changed/.test(scTableText());
      $('#modal').classList.add('hidden');
      await switchRoot(mainRoot);
      await api.runs.discard(r4.run.id, 'skip');
      await refreshRuns();
      // the scorecard step below expects this same counter to still read 3 overrides - rebuild it after proving
      // Reset actually clears it, so testing the button here doesn't erase a count a later step depends on.
      for (let i = 10; i < 13; i++) await addOverride(i);
      await refreshRuns();
      const rebuilt = ((await api.guardoverrides.get()).counts || {}).protectedPaths === 3;
      await restore();
      return suggested && projectRelaxShown && verdictBlocked && settingsSuggested && countedBefore && !countedAfter && rebuilt && /overridden/.test(text) && /Blocked/.test(text)
        ? true : `no suggestion after 3 overrides: ${JSON.stringify({ verdictBlocked, projectRelaxShown, settingsSuggested, countedBefore, countedAfter, rebuilt, diag })} ${text.slice(0, 300)}`;
    });
    await step('semantic diff: the symbol-changes button summarises added/removed/renamed functions and classes', async () => {
      const before = (await api.fs.read(state.project.root, 'util.py')).content;
      const after = before.replace('def helper(x):', 'def helper2(x):').replace('helper(1)', 'helper2(1)');
      await api.fs.write(state.project.root, 'util.py', after);
      await openDiff('util.py');
      const btn = $('#d-symbols');
      const shown = await waitFor(() => !btn.classList.contains('hidden'));
      if (shown) btn.click();
      await sleep(50);
      const text = (document.querySelector('.ctx-menu') || { textContent: '' }).textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const label = btn.textContent;
      await api.git.revert(state.project.root, 'util.py');
      await loadProject(); await refreshChanges();
      return shown && /renamed/i.test(text) && /helper/.test(text) ? true : JSON.stringify({ shown: !!shown, label, text: text.slice(0, 300) });
    });
    await step('semantic diff: the symbol-change count also shows in the merge dialog, summed across the whole run', async () => {
      const mainRoot = state.project.root;
      const r = await startRun({ task: 'rename helper', name: 'symbol count run', agent: { name: 'Smoke', command: 'echo smoke' }, allow: '**' });
      await switchRoot(r.run.root);
      const before = (await api.fs.read(state.project.root, 'util.py')).content;
      await api.fs.write(state.project.root, 'util.py', before.replace('def helper(x):', 'def helper2(x):').replace('helper(1)', 'helper2(1)'));
      await switchRoot(mainRoot);
      await mergeRunDialog(r.run);
      const row = document.querySelector('#dialog .guard-row.ok.muted');
      const text = row ? row.textContent : '';
      $('#modal').classList.add('hidden');
      await switchRoot(mainRoot);
      await api.runs.discard(r.run.id, 'skip');
      await refreshRuns();
      return /\d+ symbol changes? across this run/.test(text) ? true : JSON.stringify({ text });
    });
    await step('semantic diff: a function moved (and renamed) into a different file counts as one change, not a remove+add', async () => {
      const mainRoot = state.project.root;
      const r = await startRun({ task: 'move helper', name: 'cross-file move run', agent: { name: 'Smoke', command: 'echo smoke' }, allow: '**' });
      await switchRoot(r.run.root);
      // util.py (the fixture): "def helper(x):\n    return x\n\n\nclass Box:\n    def open(self):\n        return helper(1)\n" -
      // replace helper's two lines in place (same line count) so Box/open don't shift and register as spurious
      // "moved" entries of their own; only helper's removal (paired against helper2 below) should show up.
      await api.fs.write(state.project.root, 'util.py', '# helper moved elsewhere\n#\n\n\nclass Box:\n    def open(self):\n        return helper(1)\n');
      await api.fs.write(state.project.root, 'util2.py', 'def helper2(x):\n    return x\n');
      await api.git.stage(state.project.root, ['util2.py']);
      await switchRoot(mainRoot);
      await mergeRunDialog(r.run);
      const row = document.querySelector('#dialog .guard-row.ok.muted');
      const text = row ? row.textContent : '';
      $('#modal').classList.add('hidden');
      await switchRoot(mainRoot);
      await api.runs.discard(r.run.id, 'skip');
      await refreshRuns();
      // exactly one symbol change (a rename), not two (a remove in util.py plus an add in util2.py)
      return /^1 symbol change across this run/.test(text.trim()) ? true : JSON.stringify({ text });
    });
    await step('two agents, same task, compared', async () => {
      const mainRoot = state.project.root;
      const agent = { name: 'Smoke', command: 'echo smoke', taskCommand: 'echo {task}' };
      const r1 = await startRun({ task: 'same task', name: 'cmp one', agent, allow: '' });
      await api.fs.write(state.project.root, 'both.txt', 'one\n'); await api.fs.write(state.project.root, 'only1.txt', 'x\n');
      const r2 = await startRun({ task: 'same task', name: 'cmp two', agent: { ...agent, name: 'Other' }, allow: '', activate: false });
      const stayed = state.project.root === r1.run.root; // starting the second run must not move the IDE
      await switchRoot(r2.run.root);
      await api.fs.write(state.project.root, 'both.txt', 'two\n'); await api.fs.write(state.project.root, 'only2.txt', 'y\n');
      await switchRoot(mainRoot);
      await refreshRuns();
      await openCompare({ a: r1.run.id, b: r2.run.id });
      await waitFor(() => document.querySelector('#dialog .cmp-cols'));
      const text = $('#dialog').textContent;
      $('#modal').classList.add('hidden');
      const shows = /cmp one/.test(text) && /cmp two/.test(text) && /both\.txt/.test(text) && /only1\.txt/.test(text) && /only2\.txt/.test(text) && /Other/.test(text) && !/null|undefined/.test(text);
      const raw = await api.runs.compare({ a: r1.run.id, b: r2.run.id, gates: false });
      const c = raw.comparison;
      const data = c && c.differing.includes('both.txt') && c.onlyA.includes('only1.txt') && c.onlyB.includes('only2.txt') && !c.identical;
      const same = await api.runs.compare({ a: r1.run.id, b: r1.run.id });
      for (const r of [r1, r2]) await api.runs.discard(r.run.id, 'skip');
      await refreshRuns();
      return stayed && shows && data && !!same.error && state.runs.runs.length === 0 ? true : JSON.stringify({ stayed, shows, data, sameErr: same.error, text: text.slice(0, 300) });
    });
    await step('pull request status row (no remote: plain message, work item chip)', async () => {
      const mainRoot = state.project.root;
      const r = await startRun({ task: 'relates to AB#321', name: 'pr status', agent: { name: 'Smoke', command: 'echo smoke' }, allow: '', activate: false });
      await refreshRuns();
      const run = state.runs.runs.find((x) => x.id === r.run.id);
      await loadPrStatus(run);
      const row = document.querySelector('.run-pr');
      const text = row ? row.textContent : '';
      const res = await api.runs.status(run.id);
      await api.runs.discard(run.id, 'skip');
      delete state.prStatus[run.id];
      await refreshRuns();
      return !!row && /No origin remote/.test(text) && /AB#321/.test(text) && !/null|undefined/.test(text) && res.status && res.status.unsupported && state.project.root === mainRoot ? true : JSON.stringify({ text, status: res.status || res.error });
    });
    await step('memory: closing tabs frees their editor models; terminal scrollback follows the setting', async () => {
      const count = () => monaco.editor.getModels().length;
      const before = count();
      const files = ['a.py', 'b.py', 'util.py', 'calls.py'];
      for (const f of files) await openFile(f);
      const during = count();
      for (const t of [...state.tabs]) await closeTab(t.id);
      const after = count();
      // diff tabs create two models each
      await openFile('a.py'); await refreshChanges();
      const sb = state.terms.size ? [...state.terms.values()][0].term.options.scrollback : null;
      const expect = scrollbackSetting();
      for (const t of [...state.tabs]) await closeTab(t.id);
      await api.settings.save({ terminalScrollback: 300 });
      await loadProject();
      const applied = [...state.terms.values()].every((e) => e.term.options.scrollback === 300);
      await api.settings.save({});
      await loadProject();
      return during > before && after === before && count() === before && (sb === null || sb === expect) && (state.terms.size === 0 || applied) ? true : JSON.stringify({ before, during, after, now: count(), sb, expect, applied });
    });
    await step('review comments on diff lines are sent to the agent terminal', async () => {
      await openFile('a.py');
      await api.fs.write(state.project.root, 'a.py', `# first\n${(await api.fs.read(state.project.root, 'a.py')).content}`);
      await refreshChanges();
      await openDiff('a.py');
      const m = state.models.get('a.py');
      m.model.setValue(m.model.getValue()); // keep
      const hasBtn = !$('#d-comment').disabled && $('#d-send-comments').classList.contains('hidden');
      addCommentAt('a.py', 2, 'please explain this line');
      addCommentAt('a.py', 1, 'rename the comment');
      const shown = !$('#d-send-comments').classList.contains('hidden') && /Send 2 comments/.test($('#d-send-comments').textContent);
      const decos = !!(await waitFor(() => document.querySelectorAll('.bazinga-comment-glyph').length >= 1, 3000));
      // tracking: a line inserted above moves the comment down
      const before = [...state.comments.values()].map(commentLine).sort().join();
      m.model.pushEditOperations([], [{ range: new monaco.Range(1, 1, 1, 1), text: 'inserted\n' }], () => null);
      const after = [...state.comments.values()].map(commentLine).sort().join();
      const moved = before === '1,2' && after === '2,3';
      addCommentAt('a.py', 3, 'edited text'); // same line again edits instead of duplicating
      const edited = state.comments.size === 2;
      const entry = await newTerminal({ title: 'agent-cat', agent: 'Smoke', cwd: state.project.root, initialInput: 'cat\r', persist: false });
      await waitFor(() => entry.id !== null, 4000);
      await sleep(600);
      const ok = await sendComments(entry);
      const text = () => { const buf = entry.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
      const got = await waitFor(() => /I reviewed your changes and have 2 comments/.test(text()) && /edited text/.test(text()) && /rename the comment/.test(text()), 6000);
      const cleared = state.comments.size === 0 && $('#d-send-comments').classList.contains('hidden') && !!(await waitFor(() => document.querySelectorAll('.bazinga-comment-glyph').length === 0, 3000));
      if (entry.id !== null) api.pty.kill(entry.id);
      await api.git.revert(state.project.root, 'a.py');
      m.dirty = false; // the test edited the buffer; closing would ask whether to discard
      for (const t of [...state.tabs]) await closeTab(t.id);
      await refreshChanges();
      return hasBtn && shown && decos && moved && edited && ok && !!got && cleared ? true : JSON.stringify({ hasBtn, shown, decos, before, after, edited, ok, got: !!got, cleared, tail: text().slice(-300) });
    });
    await step('agent asking for permission: badge on the terminal tab and run chip, cleared when you answer', async () => {
      const entry = await newTerminal({ title: 'asks', agent: 'Smoke', watch: true, persist: false, initialInput: "printf 'working %.0s\\n' $(seq 1 60); printf 'Do you want to proceed? [y/N] '; read x\r" });
      const badge = await waitFor(() => document.querySelector('#bottom-tabs .badge.warnbadge'), 9000);
      const shown = !!badge && /approve/.test(badge.textContent) && !!entry.prompt;
      api.pty.write(entry.id, 'n\r'); entry.prompt = null; renderBottomTabs();
      const cleared = !document.querySelector('#bottom-tabs .badge.warnbadge');
      if (entry.id !== null) api.pty.kill(entry.id);
      closeTerminal(entry.key);
      return shown && cleared ? true : JSON.stringify({ shown, cleared, prompt: entry.prompt });
    });
    await step('terminal scrollback search: count, next, case, close', async () => {
      const entry = await newTerminal({ title: 'findme', persist: false, initialInput: "printf 'alpha nee%sle beta\\nline two\\nNee%sle again\\nthird nee%sle\\n' d d d\r" });
      await waitFor(() => /third needle/.test(Array.from({ length: entry.term.buffer.active.length }, (_, n) => entry.term.buffer.active.getLine(n)?.translateToString(true) || '').join('\n')), 6000);
      if (!entry.search) return 'search addon missing';
      openTermFind(entry);
      $('#tf-q').value = 'needle'; runTermFind(1, true);
      const counted = await waitFor(() => /^1\/3$|^\d\/3$/.test($('#tf-count').textContent), 3000);
      const first = $('#tf-count').textContent;
      runTermFind(1, false);
      await sleep(150);
      const second = $('#tf-count').textContent;
      $('#tf-case').click(); await sleep(150);
      const caseCount = await waitFor(() => /\/2$/.test($('#tf-count').textContent), 3000); const caseTextDbg = $('#tf-count').textContent; // case sensitive: 'needle' matches 2 of 3
      $('#tf-q').value = 'zzz-none'; runTermFind(1, true);
      await sleep(200);
      const none = /no match/.test($('#tf-count').textContent) && $('#tf-q').classList.contains('bad');
      $('#tf-case').click();
      const visible = !$('#term-find').classList.contains('hidden');
      closeTermFind();
      const hidden = $('#term-find').classList.contains('hidden');
      if (entry.id !== null) api.pty.kill(entry.id);
      closeTerminal(entry.key);
      return counted && first !== second && !!caseCount && none && visible && hidden ? true : JSON.stringify({ counted: !!counted, first, second, caseText: caseTextDbg, caseCount: !!caseCount, none, visible, hidden });
    });
    await step('review comments survive a restart: saved with their line text, re-attached after the file moved, stale ones dropped', async () => {
      await openFile('b.py');
      const orig = (await api.fs.read(state.project.root, 'b.py')).content;
      const m = state.models.get('b.py');
      addCommentAt('b.py', 2, 'check TWO');
      addCommentAt('b.py', 3, 'about to vanish');
      const saved = sessionPayload().project.comments.filter((c) => c.rel === 'b.py');
      const savedOk = saved.length === 2 && saved.some((c) => c.line === 2 && c.code === 'two' && c.text === 'check TWO');
      // "restart": the comments are gone from memory, the file changed meanwhile (a line added on top, the last line removed)
      for (const c of state.comments.values()) m.model.deltaDecorations([c.deco], []);
      state.comments.clear(); refreshCommentUi();
      await api.fs.write(state.project.root, 'b.py', 'zero\none\ntwo\n');
      await reloadFromDisk();
      await restoreSession({ comments: saved });
      const now = [...state.comments.values()].filter((c) => c.rel === 'b.py').map((c) => `${commentLine(c)}:${c.text}`);
      const restored = now.length === 1 && now[0] === '3:check TWO';
      for (const c of state.comments.values()) m.model.deltaDecorations([c.deco], []);
      state.comments.clear(); refreshCommentUi();
      await api.fs.write(state.project.root, 'b.py', orig); await reloadFromDisk();
      return savedOk && restored ? true : JSON.stringify({ savedOk, saved, now });
    });
    await step('external change: a file written by another process updates the open tab, the tree and the Changes list', async () => {
      await api.fs.write(state.project.root, 'ext-watch.txt', 'one\n');
      await renderTree();
      await openFile('ext-watch.txt');
      const model = state.models.get('ext-watch.txt');
      if (!model) return 'not open';
      // a tab for a file that vanishes must not stop the other tabs from refreshing (it is first in the tab order)
      await api.fs.write(state.project.root, 'ext-gone.txt', 'x\n');
      await openFile('ext-gone.txt');
      state.models.delete('ext-watch.txt'); state.models.set('ext-watch.txt', model); // keep ext-watch after ext-gone
      await api.smokeExternalWrite('ext-gone.txt', null);
      await api.smokeExternalWrite('ext-watch.txt', 'two from outside\n');
      const reloaded = await waitFor(() => (model.model.getValue() || '').includes('two from outside'), 8000);
      await api.smokeExternalWrite('ext-new-file.txt', 'brand new\n');
      const inTree = await waitFor(() => document.querySelector('#side-files .row[data-rel="ext-new-file.txt"]'), 8000);
      const inChanges = await waitFor(() => state.changes.some((c) => c.path === 'ext-new-file.txt'), 8000);
      const diag = await api.fs.diagnostics();
      const diagOk = diag.watching === true && diag.events > 0 && !!diag.lastEventFile && $('#status-watch').textContent === '● live';
      return reloaded && inTree && inChanges && diagOk ? true : JSON.stringify({ reloaded: !!reloaded, inTree: !!inTree, inChanges: !!inChanges, diag });
    });
    await step('project menu: lists open actions, closes on Escape', async () => {
      $('#btn-open').click();
      const menu = await waitFor(() => document.querySelector('#project-menu'), 3000);
      if (!menu) return 'menu did not open';
      const labels = [...menu.querySelectorAll('.pm-label')].map((e) => e.textContent);
      const hasActions = labels.includes('Open folder…') && labels.includes('Open folder in new window…');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await sleep(50);
      return hasActions && !document.querySelector('#project-menu') ? true : JSON.stringify({ labels });
    });
    await step('markdown preview: renders, sanitises, links, live update', async () => {
      window.__xss = 0;
      await api.fs.write(state.project.root, 'notes-preview.md', '# Title\n\nSome **bold** and `code`.\n\n- [x] done\n- item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[web](https://example.com/x) [bad](javascript:window.__xss=1) [rel](a.py)\n\n<script>window.__xss=2</script>\n<img src=x onerror="window.__xss=3">\n\n![remote](https://example.com/p.png)\n<iframe src="https://example.com"></iframe>\n<a href="javascript:window.__xss=4" onclick="window.__xss=5">click</a>\n');
      await openFile('notes-preview.md');
      const toggleShown = !$('#md-toggle').classList.contains('hidden');
      toggleMarkdownPreview();
      await waitFor(() => document.querySelector('#md-preview .md h1'), 3000);
      const box = $('#md-preview');
      const rendered = !!box.querySelector('h1') && !!box.querySelector('strong') && !!box.querySelector('table td') && !!box.querySelector('li');
      const editorHidden = $('#editor').classList.contains('hidden') && !box.classList.contains('hidden');
      await sleep(300);
      const safe = !box.querySelector('script, iframe, img') && !/onerror|onclick|javascript:/i.test(box.innerHTML) && window.__xss === 0;
      const links = [...box.querySelectorAll('a')].map((a) => [a.textContent, a.dataset.href || null]);
      const linkOk = links.some(([t, h]) => t === 'web' && h === 'https://example.com/x') && links.some(([t, h]) => t === 'bad' && !h) && links.some(([t, h]) => t === 'rel' && h === 'a.py') && !box.querySelector('a[href]');
      const imgNote = /\[image: remote\]/.test(box.textContent);
      // clicking a relative link opens the file
      [...box.querySelectorAll('a.md-link')].find((a) => a.textContent === 'rel').click();
      await waitFor(() => state.activeTab === 'file:a.py', 3000);
      const opened = state.activeTab === 'file:a.py';
      await openFile('notes-preview.md');
      const stillPreview = !$('#md-preview').classList.contains('hidden');
      // live update from the model
      state.models.get('notes-preview.md').model.setValue('# Changed heading\n');
      const live = await waitFor(() => /Changed heading/.test($('#md-preview').textContent), 3000);
      toggleMarkdownPreview();
      const back = !$('#editor').classList.contains('hidden') && $('#md-preview').classList.contains('hidden');
      for (const m of state.models.values()) m.dirty = false; // earlier steps edit buffers; a confirm() here would freeze the headless run
      for (const t of [...state.tabs]) await closeTab(t.id);
      return toggleShown && rendered && editorHidden && safe && linkOk && imgNote && opened && stillPreview && !!live && back ? true : JSON.stringify({ toggleShown, rendered, editorHidden, safe, linkOk, imgNote, opened, stillPreview, live: !!live, back, xss: window.__xss, links, html: box.innerHTML.slice(0, 300) });
    });
    await step('drop files and paste images into a terminal prompt', async () => {
      const entry = await newTerminal({ title: 'dropcat', agent: 'Smoke', cwd: state.project.root, initialInput: 'cat\r', persist: false });
      await waitFor(() => entry.id !== null, 4000); await sleep(500);
      const text = () => { const b = entry.term.buffer.active; return Array.from({ length: b.length }, (_, n) => (b.getLine(n) ? b.getLine(n).translateToString(true) : '')).join('\n'); };
      const mkDrop = (type, payload) => { const ev = new Event(type, { bubbles: true, cancelable: true }); ev.dataTransfer = { types: payload.types, getData: (k) => payload.data[k] || '', files: payload.files || [], dropEffect: '' }; return ev; };
      const over = mkDrop('dragover', { types: ['application/x-bazinga-path'], data: {} });
      entry.container.dispatchEvent(over);
      const accepts = over.defaultPrevented && entry.container.classList.contains('drop-target');
      entry.container.dispatchEvent(mkDrop('drop', { types: ['application/x-bazinga-path'], data: { 'application/x-bazinga-path': 'src/my file.js\na.py' } }));
      const typed = await waitFor(() => /"src\/my file\.js" a\.py/.test(text()), 4000);
      // direct format + image save through the real IPC
      const fmt = await api.drop.format(['/tmp/x y.png'], { agent: false });
      const img = await api.drop.saveImage('iVBORw0KGgo=', 'png');
      const badImg = await api.drop.saveImage('AAAA', 'exe');
      await entry.typePaths([img.path]);
      const imgTyped = await waitFor(() => /pasted-images\/paste-\d+-[0-9a-f]{6}\.png/.test(text().replace(/\n/g, '')), 4000);
      const dropNotNavigating = (() => { const ev = new Event('drop', { bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; })();
      if (entry.id !== null) api.pty.kill(entry.id);
      closeTerminal(entry.key);
      return accepts && !!typed && /'\/tmp\/x y\.png' /.test(fmt.text || '') && !img.error && !!badImg.error && !!imgTyped && dropNotNavigating ? true : JSON.stringify({ accepts, typed: !!typed, fmt, img, badImg: badImg.error, imgTyped: !!imgTyped, dropNotNavigating, tail: text().slice(-200) });
    });
    await step('model self-test panel: shows each check, the likely cause and the output; Close ends it; the Test button is only on local Claude agents', async () => {
      const ok = { ok: true, seconds: 12.3, steps: [{ id: 'attach', label: 'Sending a file with @file', ok: true, detail: 'fine' }, { id: 'write', label: 'Writing a file to disk', ok: true, detail: 'fine' }, { id: 'read', label: 'Reading a file with its tool', ok: true, detail: 'fine' }], advice: [], output: 'done', server: { contextLabel: '32k', notes: [] } };
      const bad = { ok: false, seconds: 4, steps: [{ id: 'attach', label: 'Sending a file with @file', ok: true, detail: 'fine' }, { id: 'write', label: 'Writing a file to disk', ok: false, detail: 'No file was created.' }], advice: ['The model wrote the tool call as plain text instead of making it, so nothing ran.'], output: '{"name":"Write"}', server: { contextLabel: '4k', notes: ['also loaded: x'] } };
      const agent = { name: 'qwen3:8b', command: 'claude --model qwen3:8b', env: { ANTHROPIC_BASE_URL: 'http://localhost:11434' } };
      let sawRunning = false; let sawTimer = false; let second = null;
      const p1 = await testAgentModel(agent, async (a, onP) => {
        onP({ id: 'prepare', state: 'running' });
        sawRunning = !!document.querySelector('.overlay-panel .test-step.running');
        sawTimer = /Running for \d+s/.test(document.querySelector('.overlay-panel').textContent) && document.querySelector('.overlay-panel .actions button').textContent === 'Cancel';
        second = await testAgentModel(agent, async () => { throw new Error('must not start a second test'); }); // a second click while running
        onP({ id: 'prepare', state: 'done', ok: true, detail: 'Model loaded with a 32k context.' });
        onP({ id: 'attach', state: 'running' });
        return ok;
      });
      const t1 = document.querySelector('.overlay-panel').textContent;
      const passed = sawRunning && sawTimer && second && second.root === p1.root && document.querySelectorAll('.overlay-panel').length === 1 && /Passed in 12.3s/.test(t1) && document.querySelectorAll('.test-step.ok').length === 4 && /32k context/.test(t1) && document.querySelector('.overlay-panel .actions button').textContent === 'Close';
      p1.close();
      const closed = !document.querySelector('.overlay-panel');
      const p2 = await testAgentModel(agent, async () => bad);
      const t2 = document.querySelector('.overlay-panel').textContent;
      const failed = /Not everything works/.test(t2) && document.querySelectorAll('.test-step.bad').length === 1 && /plain text instead of making it/.test(t2) && /No file was created/.test(t2) && /also loaded: x/.test(t2) && !!document.querySelector('.overlay-panel details');
      p2.close();
      const errPanel = await testAgentModel(agent, async () => ({ error: 'A model test is already running.' }));
      const errShown = /already running/.test(document.querySelector('.overlay-panel').textContent);
      errPanel.close();
      await openSettings();
      document.querySelector('#set-tab-agents').click();
      const preset = document.querySelector('#set-preset');
      // the button is icon + text ("Test"), and the icon span's inline SVG has indentation whitespace text nodes,
      // so button.textContent is "  Test", not "Test" - trim before comparing.
      const hasTest = (r) => [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Test');
      const before = [...document.querySelectorAll('#dialog .agent-row')].filter(hasTest).length;
      preset.value = '2'; preset.dispatchEvent(new Event('change'));
      const after = [...document.querySelectorAll('#dialog .agent-row')].filter(hasTest).length;
      preset.value = '3'; preset.dispatchEvent(new Event('change'));
      // aider's row is a new one but adds no Test button of its own - the count should stay exactly at `after`.
      const aider = [...document.querySelectorAll('#dialog .agent-row')].filter(hasTest).length;
      $('#modal').classList.add('hidden');
      return passed && closed && failed && errShown && before === 0 && after === 1 && aider === after ? true : JSON.stringify({ passed, sawRunning, sawTimer, closed, failed, errShown, before, after, aider });
    });
    await step('settings + session store', async () => {
      await api.settings.save({ autoCheck: true });
      const s = await api.settings.get();
      await api.settings.save({});
      await api.session.save({ project: { tabs: [{ kind: 'file', rel: 'a.py' }], active: 'file:a.py' } });
      const sess = await api.session.get();
      return s.settings.autoCheck === true && sess.project && sess.project.active === 'file:a.py';
    });
    await step('settings dialog opens', async () => {
      await openSettings();
      const ok = !$('#modal').classList.contains('hidden') && document.querySelectorAll('#dialog input').length >= 5;
      $('#modal').classList.add('hidden');
      return ok;
    });

    await step('settings dialog: tabs show one group at a time, presets add an agent, Save keeps values from every tab', async () => {
      const prev = (await api.settings.get()).settings;
      try { localStorage.removeItem('bazinga.settingsTab'); } catch { /* ignore */ }
      await openSettings();
      const tabs = [...document.querySelectorAll('#dialog .set-tab')].map((b) => b.textContent);
      const visible = () => [...document.querySelectorAll('#dialog .set-panel')].filter((p) => !p.classList.contains('hidden')).map((p) => p.id);
      const first = visible();
      document.querySelector('#set-tab-agents').click();
      const agentsTab = visible();
      const preset = document.querySelector('#set-preset');
      const rowsBefore = document.querySelectorAll('#dialog .agent-row').length;
      preset.value = '3'; preset.dispatchEvent(new Event('change'));
      const rowsAfter = document.querySelectorAll('#dialog .agent-row').length;
      document.querySelector('#set-tab-oversight').click();
      const sel = document.querySelector('#set-panel-oversight select');
      sel.value = 'guided'; sel.dispatchEvent(new Event('change'));
      document.querySelector('#set-tab-general').click();
      const fonts = [...document.querySelectorAll('#set-panel-general input[type=number]')];
      const arrowKey = (() => { document.querySelector('#dialog .set-tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return visible()[0]; })();
      [...document.querySelectorAll('#dialog button')].find((b) => b.textContent === 'Save').click();
      await sleep(600);
      const now = (await api.settings.get()).settings;
      const saved = now.oversight === 'guided' && (now.agents || []).some((a) => a.name === 'qwen3:8b' && a.command.startsWith('aider') && a.env && a.env.OLLAMA_API_BASE);
      await api.settings.save(prev); await loadProject();
      const remembered = (() => { try { return localStorage.getItem('bazinga.settingsTab'); } catch { return 'agents'; } })();
      return tabs.length === 7 && first.join() === 'set-panel-general' && agentsTab.join() === 'set-panel-agents' && rowsAfter === rowsBefore + 1 && arrowKey === 'set-panel-agents' && saved && fonts.length >= 0 && !!remembered ? true : JSON.stringify({ tabs, first, agentsTab, rowsBefore, rowsAfter, arrowKey, saved, remembered });
    });
    await step('auto-merge: per-kind-of-task checkboxes save as a narrowed list, and as null when every box stays checked', async () => {
      const prev = (await api.settings.get()).settings;
      await openSettings();
      document.querySelector('#set-tab-oversight').click();
      const boxes = [...document.querySelectorAll('#set-panel-oversight .check input[type=checkbox]')];
      const docsBox = boxes.find((b) => b.closest('label').textContent.includes('Docs'));
      docsBox.checked = false; docsBox.dispatchEvent(new Event('change'));
      [...document.querySelectorAll('#dialog button')].find((b) => b.textContent === 'Save').click();
      await sleep(600);
      const narrowed = (await api.settings.get()).settings;
      const okNarrowed = Array.isArray(narrowed.autoMerge.kinds) && !narrowed.autoMerge.kinds.includes('docs') && narrowed.autoMerge.kinds.includes('bugfix');
      await openSettings();
      document.querySelector('#set-tab-oversight').click();
      const boxes2 = [...document.querySelectorAll('#set-panel-oversight .check input[type=checkbox]')];
      const docsBox2 = boxes2.find((b) => b.closest('label').textContent.includes('Docs'));
      const reflectsNarrowed = docsBox2.checked === false;
      docsBox2.checked = true; docsBox2.dispatchEvent(new Event('change'));
      [...document.querySelectorAll('#dialog button')].find((b) => b.textContent === 'Save').click();
      await sleep(600);
      const widened = (await api.settings.get()).settings;
      const okWidened = widened.autoMerge.kinds === null; // every kind checked again = no restriction, same as before this ever existed
      await api.settings.save(prev); await loadProject();
      return okNarrowed && reflectsNarrowed && okWidened ? true : JSON.stringify({ okNarrowed, reflectsNarrowed, okWidened, narrowedKinds: narrowed.autoMerge.kinds, widenedKinds: widened.autoMerge.kinds });
    });
    await step('oversight level: setting → status indicator, task prefix, guard rules; project level wins', async () => {
      const prev = (await api.settings.get()).settings;
      await api.settings.save({ ...prev, oversight: 'guided' });
      await loadProject();
      const ide = $('#status-oversight').textContent;
      const cfg = state.project.config;
      const okIde = /Guided/.test(ide) && cfg.fixLoop.enabled === false && cfg.mergeGuard.unreviewed === 'block' && /plan/i.test(cfg.taskPrefix || '') && withTaskPrefix('x').endsWith('\n\nx');
      const origCfg = (await api.fs.read(state.project.root, '.ide/config.json')).content;
      await api.fs.write(state.project.root, '.ide/config.json', JSON.stringify({ ...JSON.parse(origCfg), oversight: 'autonomous' }));
      await loadProject();
      const proj = $('#status-oversight').textContent;
      const okProj = /Autonomous/.test(proj) && state.project.config.fixLoop.enabled === true && state.project.oversight.source === 'project'
        && state.project.config.autoMerge.enabled === true; // "Autonomous" is the natural place to default auto-merge on
      await api.fs.write(state.project.root, '.ide/config.json', origCfg);
      await api.settings.save(prev);
      await loadProject();
      return okIde && okProj ? true : JSON.stringify({ ide, proj, okIde, okProj });
    });
    await step('task templates, review rules, budget and safety settings are in the dialogs', async () => {
      openRunDialog();
      const tpl = [...document.querySelectorAll('#dialog select option')].some((o) => /Fix a bug/.test(o.textContent));
      $('#modal').classList.add('hidden');
      await openSettings();
      const text = $('#dialog').textContent;
      const ok = /Human in the loop/.test(text) && /Review rules/.test(text) && /Time budget per run/.test(text) && /Task templates/.test(text) && /Bugfix without a new or changed test/.test(text) && /immutable/.test(text) && /Docker container/.test(text);
      $('#modal').classList.add('hidden');
      return tpl && ok ? true : JSON.stringify({ tpl, ok });
    });
    await step('container runs: check works, a plan for an unknown run is refused', async () => {
      const chk = await api.container.check();
      const plan = await api.container.plan({ runId: 'nope', task: 'x', shell: 'posix' });
      return typeof chk.docker === 'boolean' && chk.enabled === false && !!plan.error ? true : JSON.stringify({ chk, plan });
    });
    await step('container run: the docker command line is built and typed, the terminal is marked, restore does not resume it on the host', async () => {
      const mainRoot = state.project.root;
      const prev = (await api.settings.get()).settings;
      await api.settings.save({ ...prev, agentContainer: { enabled: true } });
      await loadProject();
      let r;
      try { r = await startRun({ task: 'boxed task', name: 'boxed run', agent: { name: 'Smoke', command: 'echo boxed', taskCommand: 'echo {task}' } }); } finally { await api.settings.save(prev); }
      if (!r || !r.entry) return 'start failed';
      // the long docker command line wraps across several buffer rows at this terminal's width while zsh's own line
      // editor redraws it (not plain terminal auto-wrap, isWrapped doesn't reliably cover it), so joining rows with
      // '\n' can split a word straddling the wrap - "--network" became "--n\network", taking GIT_DIR=.../bazinga-agent:latest
      // further along the same logical line down with it. These are presence checks, not structure, so no separator at all.
      const text = () => { const b = r.entry.term.buffer.active; let out = ''; for (let n = 0; n < b.length; n++) { const line = b.getLine(n); if (line) out += line.translateToString(true); } return out; };
      const typed = await waitFor(() => /docker run --rm -it/.test(text()) && /--cap-drop ALL/.test(text()) && /GIT_DIR=\/gitcommon\/worktrees\//.test(text()) && /bazinga-agent:latest/.test(text()), 6000);
      const marked = r.entry.sandboxed === true && state.project && /🐳/.test(r.entry.title);
      const hasContainer = !!r.entry.container && typeof r.entry.container.classList === 'object'; // regression: a flag named "container" replaced the terminal's DOM element
      const rec = sessionPayload().project.terminals.find((t) => t.runId === r.run.id);
      const recOk = !!rec && rec.container === true;
      await switchRoot(mainRoot);
      await loadProject();
      return typed && marked && hasContainer && recOk ? true : JSON.stringify({ typed, marked, hasContainer, recOk, text: text().slice(0, 400) });
    });
    await step('workflow: steps chain through gates and approval, a failing gate stops it, state is persisted', async () => {
      const list = await api.workflow.list();
      const builtins = list.workflows.filter((w) => w.source === 'built-in' && w.workflow).length === 2;
      const mk = (name, steps) => ({ name, source: 'project', workflow: { name, description: '', steps: steps.map((x) => ({ agent: '', gate: 'none', needs: [], approval: null, retries: 0, allow: '', ...x })) } });
      // 1) a -> (human approval) -> b, b continues in a's worktree
      await wfStartNew(mk('chain', [{ id: 'a', task: 'step a {input}', approval: 'human' }, { id: 'b', task: 'step b', needs: ['a'] }]), 'the input');
      const st = [...state.workflows.values()].find((x) => x.name === 'chain');
      const entryA = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st.id && t.wf.stepId === 'a');
      const cardGraph = !!(await waitFor(() => document.querySelectorAll('#a-workflows .wf-graph .wf-g-running').length === 1, 3000));
      const aRunning = wfStepStatus(st, 'a') === 'running' && wfStepStatus(st, 'b') === 'waiting' && !!entryA;
      await wfOnIdle(entryA);
      const waitsForYou = wfStepStatus(st, 'a') === 'awaiting-approval' && wfStepStatus(st, 'b') === 'waiting' && !!document.querySelector('#a-workflows button.primary');
      await wfAction(st, 'a', 'approve');
      const entryB = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st.id && t.wf.stepId === 'b');
      const sameRun = !!entryB && st.steps.b.runId === st.steps.a.runId;
      entryB.prompt = { text: 'Would you like to run the tests?', at: Date.now() }; // a question in the model's last message looked like a permission prompt
      await wfOnIdle(entryB);
      const stuck = wfStepStatus(st, 'b') === 'running';
      const doneBtn = !!document.querySelector('#a-workflows .wf-done');
      await wfAction(st, 'b', 'done'); // the Done button goes on anyway
      const finished = stuck && doneBtn && wfStepStatus(st, 'b') === 'passed' && !!st.finished;
      // 2) a failing gate (no retries) stops the workflow and does not start the next step
      await wfStartNew(mk('gated', [{ id: 'g', task: 'x', gate: 'tests-added' }, { id: 'h', task: 'y', needs: ['g'] }]), '');
      const st2 = [...state.workflows.values()].find((x) => x.name === 'gated');
      await wfOnIdle([...state.terms.values()].find((t) => t.wf && t.wf.wfId === st2.id && t.wf.stepId === 'g'));
      const stopped = wfStepStatus(st2, 'g') === 'failed' && wfStepStatus(st2, 'h') === 'waiting';
      // 3) persisted
      const saved = (await api.workflow.load()).states;
      const persisted = saved.some((x) => x.id === st.id && x.finished) && saved.some((x) => x.id === st2.id && x.steps.g.status === 'failed');
      const gateErr = !!(await api.workflow.gate({ runId: 'nope', gate: 'none' })).error;
      await openWorkflows();
      const pickers = !!(await waitFor(() => document.querySelector('#wf-default-agent') && document.querySelectorAll('.wf-step-agent').length > 0 && document.querySelector('#wf-pull'), 3000));
      document.querySelector('#wf-pull').click(); // no Azure DevOps here: the picker explains instead of failing
      // this is an IPC round trip (providers, then the list call) on top of ~70 earlier steps' worth of accumulated
      // terminals/Monaco models, so 6s was too tight under load even though the round trip itself is cheap - give it more room.
      const explained = !!(await waitFor(() => /Pull in a work item/.test($('#dialog').textContent) && /No Azure DevOps project|not installed|Azure|az /.test($('#dialog .hint').textContent), 12000));
      const dialogDump = explained ? null : { title: $('#dialog h3') && $('#dialog h3').textContent, hints: [...document.querySelectorAll('#dialog .hint')].map((h) => h.textContent) };
      $('#dialog .actions button').click(); // Back: the workflow dialog again, with its input
      const back = !!(await waitFor(() => /Start a workflow/.test($('#dialog').textContent), 3000));
      $('#modal').classList.add('hidden');
      for (const x of [st, st2]) { state.workflows.delete(x.id); await api.workflow.remove(x.id); }
      renderWorkflows();
      return builtins && cardGraph && aRunning && waitsForYou && sameRun && finished && stopped && persisted && gateErr && pickers && explained && back ? true : JSON.stringify({ explained, back, builtins, cardGraph, aRunning, waitsForYou, sameRun, finished, stuck, doneBtn, bStatus: wfStepStatus(st, 'b'), stopped, persisted, gateErr, pickers, dialogDump });
    });
    await step('workflow: unattended mode ends with the process, a bad exit code relaunches with the findings, finish: merge stops with a reason', async () => {
      const mk = (name, extra, steps) => ({ name, source: 'project', workflow: { name, description: '', ...extra, steps: steps.map((x) => ({ agent: '', gate: 'none', needs: [], approval: null, retries: 1, allow: '', ...x })) } });
      await wfStartNew(mk('unatt', { mode: 'unattended' }, [{ id: 'a', task: 'step a' }]), '');
      const st = [...state.workflows.values()].find((x) => x.name === 'unatt');
      const first = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st.id && t.wf.stepId === 'a');
      const modeKept = st.mode === 'unattended' && !!first;
      first.printMode = true; // the smoke agent is not Claude Code, so pretend its command was the print command
      const before = [...state.terms.values()].length;
      await wfOnIdle(first, { force: true, exitCode: 2 });
      const relaunched = wfStepStatus(st, 'a') === 'running' && st.steps.a.attempts === 2 && [...state.terms.values()].length === before + 1;
      const second = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st.id && t.wf.stepId === 'a' && t !== first);
      // a second bad exit with no retries left: failed, nothing launched
      second.printMode = true;
      await wfOnIdle(second, { force: true, exitCode: 2 });
      const failed = wfStepStatus(st, 'a') === 'failed' && /exit code 2/.test(st.steps.a.why || '');
      await wfStartNew(mk('fin', { finish: 'merge' }, [{ id: 'a', task: 'step a', retries: 0 }]), '');
      const st2 = [...state.workflows.values()].find((x) => x.name === 'fin');
      const e2 = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st2.id);
      await wfOnIdle(e2, { force: true });
      const finishNote = !!(await waitFor(() => !!st2.finishNote, 15000));
      const stopped = /^Not merged/.test(st2.finishNote || '') || /^Merge did not happen/.test(st2.finishNote || '');
      for (const x of [st, st2]) { state.workflows.delete(x.id); await api.workflow.remove(x.id); }
      renderWorkflows();
      return modeKept && relaunched && failed && finishNote && stopped ? true : JSON.stringify({ modeKept, relaunched, failed, finishNote, stopped, note: st2.finishNote, status: wfStepStatus(st, 'a'), attempts: st.steps.a && st.steps.a.attempts });
    });
    await step('workflow: a step over its time limit is stopped and fails; a step whose agent is gone can be resumed', async () => {
      const mk = (name, steps) => ({ name, source: 'project', workflow: { name, description: '', steps: steps.map((x) => ({ agent: '', gate: 'none', needs: [], approval: null, retries: 1, timeout: 0, allow: '', ...x })) } });
      await wfStartNew(mk('slow', [{ id: 'a', task: 'step a', timeout: 1 }]), '');
      const st = [...state.workflows.values()].find((x) => x.name === 'slow');
      await waitFor(() => [...state.terms.values()].some((t) => t.wf && t.wf.wfId === st.id), 15000);
      st.steps.a.startedAt = Date.now() - 2 * 60000; // two minutes ago
      const timedOut = !!(await waitFor(() => wfStepStatus(st, 'a') === 'failed' && /stopped after 1 minutes/.test(st.steps.a.why || ''), 12000));
      await wfStartNew(mk('gone', [{ id: 'a', task: 'step a' }]), '');
      const st2 = [...state.workflows.values()].find((x) => x.name === 'gone');
      await waitFor(() => [...state.terms.values()].some((t) => t.wf && t.wf.wfId === st2.id), 15000);
      const e2 = [...state.terms.values()].find((t) => t.wf && t.wf.wfId === st2.id);
      e2.exited = true; renderWorkflows(); // the terminal is gone, as after a restart
      const resumeBtn = !!document.querySelector('#a-workflows .wf-resume');
      const before = [...state.terms.values()].length;
      await wfAction(st2, 'a', 'resume');
      const resumed = wfStepStatus(st2, 'a') === 'running' && [...state.terms.values()].length === before + 1;
      for (const x of [st, st2]) { state.workflows.delete(x.id); await api.workflow.remove(x.id); }
      renderWorkflows();
      return timedOut && resumeBtn && resumed ? true : JSON.stringify({ timedOut, resumeBtn, resumed, status: wfStepStatus(st, 'a'), why: st.steps.a.why });
    });
    await step('workflow self-check: runs the two-step check, shows a failing step with advice, cleans up', async () => {
      await openWorkflowSelfCheck();
      document.querySelector('#wfs-start').click();
      const started = !!(await waitFor(() => [...state.workflows.values()].some((x) => x.name === 'Bazinga self-check' && x.steps.write && x.steps.write.runId), 15000));
      const st = [...state.workflows.values()].find((x) => x.name === 'Bazinga self-check');
      const findEntry = () => [...state.terms.values()].find((t) => t.wf && st && t.wf.wfId === st.id);
      await waitFor(() => !!findEntry(), 15000);
      const entry = findEntry();
      const listed = !!(await waitFor(() => document.querySelectorAll('#dialog .wfs-item').length === 5, 4000));
      await wfOnIdle(entry); // the smoke agent changes no files: the check of step 1 fails
      const failing = !!(await waitFor(() => document.querySelector('#dialog .wfs-fail') && /did not use its Write tool/.test($('#dialog').textContent), 8000));
      const rerun = !document.querySelector('#wfs-start').disabled;
      document.querySelector('#wfs-clean').click();
      const cleaned = !!(await waitFor(() => ![...state.workflows.values()].some((x) => x.name === 'Bazinga self-check'), 8000));
      $('#modal').classList.add('hidden');
      return started && listed && failing && rerun && cleaned ? true : JSON.stringify({ started, listed, failing, rerun, cleaned });
    });
    await step('jira: the picker offers both sources, the setup form refuses a bad URL and a missing token', async () => {
      let picked = null;
      await openWorkItems((text) => { picked = text; }, null);
      const both = !!document.querySelector('#wi-provider') && document.querySelectorAll('#wi-provider option').length === 2;
      document.querySelector('#wi-jira-setup').click();
      const form = !!(await waitFor(() => document.querySelector('#jira-url') && document.querySelector('#jira-token'), 3000));
      const type = (id, v) => { const i = document.querySelector(id); i.value = v; };
      type('#jira-url', 'http://jira.example.com'); type('#jira-email', 'a@b.c'); type('#jira-token', 'x');
      document.querySelector('#jira-save').click();
      const badUrl = !!(await waitFor(() => /must start with https/.test($('#jira-msg').textContent), 4000));
      type('#jira-url', 'https://example.invalid'); type('#jira-token', '');
      document.querySelector('#jira-save').click();
      const noToken = !!(await waitFor(() => /Paste an API token/.test($('#jira-msg').textContent), 4000));
      document.querySelector('#dialog .actions button').click(); // Cancel: back to the picker
      const back = !!(await waitFor(() => document.querySelector('#wi-provider'), 3000));
      $('#modal').classList.add('hidden');
      return both && form && badUrl && noToken && back && picked === null ? true : JSON.stringify({ both, form, badUrl, noToken, back, picked });
    });
    await step('debug tab: shows what the workflow did, filters by source, copies and clears', async () => {
      showDebug();
      const shown = !!(await waitFor(() => state.bottom === 'debug' && $('#debug').style.display !== 'none' && document.querySelectorAll('#debug .dbg-row.dbg-workflow').length > 0, 4000));
      const hasGate = [...document.querySelectorAll('#debug .dbg-x')].some((x) => /gate/.test(x.textContent));
      document.querySelector('#debug .dbg-f[data-k="idle"]').click();
      const filtered = document.querySelectorAll('#debug .dbg-row.dbg-workflow').length === 0;
      document.querySelector('#debug .dbg-f[data-k=""]').click();
      dbg('app', 'smoke marker');
      const live = !!(await waitFor(() => [...document.querySelectorAll('#debug .dbg-x')].some((x) => x.textContent === 'smoke marker'), 4000));
      document.querySelector('#dbg-clear').click();
      const cleared = !!(await waitFor(() => document.querySelectorAll('#debug .dbg-row').length === 0, 3000));
      closeDebug();
      const closed = state.bottom !== 'debug' && !document.querySelector('.btab .x[onclick]') ? true : state.bottom !== 'debug';
      return shown && hasGate && filtered && live && cleared && closed ? true : JSON.stringify({ shown, hasGate, filtered, live, cleared, closed });
    });
    await step('workflow editor: build a workflow with the form, errors show, it is saved as a file, reloads, can be deleted', async () => {
      await openWorkflowEditor(null);
      const d = $('#dialog');
      const setVal = (node, v) => { node.value = v; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); };
      const btn = (t) => [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
      setVal(d.querySelector('input[type=text]'), 'Smoke form flow');
      await sleep(500);
      const emptyTaskError = /task is missing/.test(d.textContent);
      setVal(d.querySelector('.wf-edit-step textarea'), 'Do the thing: {input}');
      btn('Add step').click();
      await sleep(100);
      const steps = d.querySelectorAll('.wf-edit-step');
      const second = steps[1];
      setVal(second.querySelector('textarea'), 'Then review');
      const selects = second.querySelectorAll('select');
      setVal(selects[1], 'tests-added'); // check
      await sleep(500);
      const noErrors = !d.querySelector('.hint.danger').textContent;
      const graphDrawn = d.querySelectorAll('.wf-graph .wf-g-node').length === 2 && d.querySelectorAll('.wf-graph .wf-g-edge').length === 1;
      const firstUpDisabled = steps[0].querySelector('button[aria-label="Move up"]').hasAttribute('disabled') && !second.querySelector('button[aria-label="Move up"]').hasAttribute('disabled');
      btn('Save').click();
      await waitFor(() => /Start a workflow/.test($('#dialog').textContent), 4000);
      const list = await api.workflow.list();
      const mine = list.workflows.find((w) => w.name === 'Smoke form flow');
      const saved = !!mine && mine.source === 'project' && mine.workflow.steps.length === 2 && mine.workflow.steps[1].gate === 'tests-added' && mine.workflow.steps[1].needs[0] === mine.workflow.steps[0].id && mine.workflow.steps[0].task === 'Do the thing: {input}';
      const inStartDialog = [...$('#dialog').querySelectorAll('option')].some((o) => /Smoke form flow/.test(o.textContent));
      await api.workflow.deleteFile({ source: 'project', file: mine.file });
      const gone = !(await api.workflow.list()).workflows.some((w) => w.name === 'Smoke form flow');
      $('#modal').classList.add('hidden');
      return emptyTaskError && noErrors && graphDrawn && firstUpDisabled && saved && inStartDialog && gone ? true : JSON.stringify({ emptyTaskError, noErrors, graphDrawn, firstUpDisabled, saved, inStartDialog, gone });
    });
    await step('folders: right-click marks source / test folders, badge in the tree, saved in .ide/config.json and AGENTS.md, cleared again', async () => {
      const origCfg = (await api.fs.read(state.project.root, '.ide/config.json')).content || '';
      try {
        await renderTree();
        const menuFor = async (rel) => {
          document.querySelector(`#side-files .row[data-rel="${rel}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
          await sleep(50);
          return [...document.querySelectorAll('.ctx-menu .ctx-item')];
        };
        const items = await menuFor('tests');
        const labels = items.map((b) => b.textContent);
        items.find((b) => /Mark as test folder/.test(b.textContent)).click();
        await sleep(800);
        const menuClosed = document.querySelectorAll('.ctx-menu').length === 0;
        const badge = document.querySelector('#side-files .row[data-rel="tests"] .role');
        const badged = !!badge && badge.textContent === 'test' && badge.classList.contains('role-tests');
        const saved1 = JSON.parse((await api.fs.read(state.project.root, '.ide/config.json')).content || '{}').folders;
        const second = await api.folders.mark('svc/src/main/java', 'source'); await loadProject();
        const agentsMd = (await api.fs.read(state.project.root, 'AGENTS.md')).content || '';
        const block = /bazinga:folders:start/.test(agentsMd) && /Source code: svc\/src\/main\/java/.test(agentsMd) && /Tests: tests/.test(agentsMd);
        const nested = (await api.fs.list(state.project.root, 'svc/src/main/java')).length >= 0 && state.project.config.folders.source.includes('svc/src/main/java');
        const again = await menuFor('tests');
        const checked = again.find((b) => /Mark as test folder/.test(b.textContent)).classList.contains('checked');
        const clearEnabled = !again.find((b) => /Clear mark/.test(b.textContent)).disabled;
        again.find((b) => /Clear mark/.test(b.textContent)).click();
        await sleep(800);
        const cleared = !((document.querySelector('#side-files .row[data-rel="tests"] .role') || {}).textContent);
        const root = await api.folders.mark('', 'source');
        await api.folders.mark('svc/src/main/java', null); await loadProject();
        const md2 = (await api.fs.read(state.project.root, 'AGENTS.md')).content || '';
        const gone = !/bazinga:folders/.test(md2);
        const cfgAfter = JSON.parse((await api.fs.read(state.project.root, '.ide/config.json')).content || '{}');
        const ok = labels.length === 11 && menuClosed && badged && JSON.stringify(saved1) === JSON.stringify({ tests: ['tests'] }) && !second.error && block && nested && checked && clearEnabled && cleared && !!root.error && gone && !cfgAfter.folders;
        return ok ? true : JSON.stringify({ labels, menuClosed, badged, saved1, second, block, nested, checked, clearEnabled, cleared, root, gone, cfgAfter });
      } finally {
        await api.fs.write(state.project.root, '.ide/config.json', origCfg || '{}\n');
        await loadProject(); await renderTree();
      }
    });

    await step('REST client: body/response get Monaco syntax highlighting, language follows Content-Type over sniffing, cleaned up on close', async () => {
      openRestTab();
      const tab = activeTab();
      if (!tab || tab.kind !== 'rest') return 'no rest tab opened';
      const rendered = !!$('#rest').querySelector('.rest-body-editor .monaco-editor');
      const defaultLang = restBodyEditor && restBodyEditor.model.getLanguageId();
      restBodyEditor.model.setValue('{"a":1}'); // no Content-Type set yet: language should follow the body's own shape
      const sniffedJson = restBodyEditor.model.getLanguageId();
      tab.headers.push({ key: 'Content-Type', value: 'application/xml' }); // an explicit header wins over sniffing
      renderRestTab(tab);
      const explicitXml = restBodyEditor.model.getLanguageId();
      const bodyTabId = restBodyEditor.tabId;
      await closeTab(tab.id);
      const disposedOnClose = restBodyEditor === null || restBodyEditor.tabId !== bodyTabId;
      const ok = rendered && defaultLang === 'plaintext' && sniffedJson === 'json' && explicitXml === 'xml' && disposedOnClose;
      return ok ? true : JSON.stringify({ rendered, defaultLang, sniffedJson, explicitXml, disposedOnClose });
    });

    await step('REST client: the auth helper, environment variables (.ide/environments.yaml) and folder-grouped saved requests', async () => {
      try {
        await api.fs.write(state.project.root, '.ide/environments.yaml', 'environments:\n  - name: dev\n    vars:\n      host: localhost:9999\nactive: dev\n');
        await api.rest.save([
          { name: 'Get widgets', method: 'GET', url: 'https://example.test/widgets', folder: 'Billing', auth: { type: 'none' } },
          { name: 'List invoices', method: 'GET', url: 'https://example.test/invoices', folder: 'Billing', auth: { type: 'bearer', token: 'x' } },
          { name: 'Health check', method: 'GET', url: 'https://example.test/health', folder: '', auth: { type: 'none' } },
        ]);
        restCollection = null; // the sidebar caches .ide/requests.yaml for the session - force a re-fetch of what was just written
        openRestTab();
        const tab = activeTab();
        if (!tab || tab.kind !== 'rest') return 'no rest tab opened';

        // the environment picker starts with just a "No environment" option and fills in from an async IPC
        // call after the synchronous render - wait for that, not for !disabled (false by default either way)
        const envSelEl = await waitFor(() => { const s = $('#rest .rest-env'); return s && s.options.length > 1 ? s : null; });
        const envOk = !!envSelEl && !envSelEl.disabled && envSelEl.value === 'dev';

        // auth helper: switching type redraws its fields, and typing into them lands straight on tab.auth
        const typeSel = $('#rest .rest-auth-row select');
        typeSel.value = 'bearer'; typeSel.dispatchEvent(new Event('change'));
        const tokenIn = $('#rest .rest-auth-row input.rest');
        tokenIn.value = 'tok-abc'; tokenIn.dispatchEvent(new Event('input'));
        const authOk = tab.auth.type === 'bearer' && tab.auth.token === 'tok-abc';

        // folders: an async IPC call too, and the ungrouped request must sort before the named folder's header
        await waitFor(() => (/Health check/.test($('#rest .rest-list').textContent) ? true : null));
        const order = [...$('#rest .rest-list').children].map((n) => n.textContent);
        const healthIdx = order.findIndex((t) => /Health check/.test(t));
        const billingHeadIdx = order.findIndex((t) => t === 'Billing');
        const widgetsIdx = order.findIndex((t) => /Get widgets/.test(t));
        const invoicesIdx = order.findIndex((t) => /List invoices/.test(t));
        const foldersOk = healthIdx === 0 && billingHeadIdx > healthIdx && widgetsIdx > billingHeadIdx && invoicesIdx > billingHeadIdx;

        await closeTab(tab.id);
        const ok = envOk && authOk && foldersOk;
        return ok ? true : JSON.stringify({ envOk, authOk, foldersOk, order });
      } finally {
        await api.rest.save([]); restCollection = null;
        await api.fs.delete(state.project.root, '.ide/environments.yaml');
      }
    });

    await step('skills: two levels listed, removable; bad source gives an error', async () => {
      await openSkills();
      await sleep(300);
      const listed = /demo/.test($('#dialog').textContent) && /IDE level/.test($('#dialog').textContent);
      // the skills.sh search box answers with results or a readable error (this machine may have no internet), and a one-letter query is not sent
      const qbox = document.querySelector('#sk-q');
      qbox.value = 'x'; qbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await sleep(100);
      const shortIgnored = document.querySelector('.skills-found').textContent === '';
      qbox.value = 'spring boot testing'; qbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      const searched = !!(await waitFor(() => { const t = document.querySelector('.skills-found').textContent; return t && !/^Searching/.test(t); }, 20000));
      const bad = await api.skills.fetch('git@github.com:a/b.git');
      const expired = await api.skills.install({ token: 'nope', names: ['x'], level: 'project' });
      const r = await api.skills.list();
      const sync = await api.skills.sync(); // an older install exists in .claude/skills only: it must reach the other agents too
      const mirrored = (await api.fs.read(state.project.root, '.agents/skills/demo/SKILL.md')).content || '';
      const index = (await api.fs.read(state.project.root, 'AGENTS.md')).content || '';
      const synced = /Demo skill/.test(mirrored) && sync.copied.length >= 1 && /bazinga:skills:start/.test(index) && /\*\*demo\*\*: Demo skill/.test(index) && /\.claude\/skills\/demo\/SKILL\.md/.test(index);
      const rm = await api.skills.remove({ level: 'project', name: 'demo' });
      const after = await api.skills.list();
      const gone = (await api.fs.read(state.project.root, '.agents/skills/demo/SKILL.md')).missing === true && !/\*\*demo\*\*/.test((await api.fs.read(state.project.root, 'AGENTS.md')).content || '');
      $('#modal').classList.add('hidden');
      return listed && qbox && shortIgnored && searched && synced && gone && !!bad.error && !!expired.error && r.project.length === 1 && rm.removed && after.project.length === 0 ? true : JSON.stringify({ listed, synced, gone, bad, rm, sync });
    });

    await step('light mode + roboto', async () => {
      await loadFonts();
      const fontsLoaded = document.fonts.check('13px Roboto') && document.fonts.check('bold 13px "Roboto Mono"');
      await openFile('a.py');
      await sleep(300);
      const usesRoboto = /^Roboto/.test(getComputedStyle(document.body).fontFamily) && /Roboto Mono/.test(getComputedStyle($('#review')).fontFamily + getComputedStyle(document.querySelector('.review-out') || $('#review')).fontFamily);
      await setThemeSetting('light');
      await sleep(200);
      const attrLight = document.documentElement.dataset.theme === 'light';
      const bgLight = getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)';
      const monacoLight = !!document.querySelector('.monaco-editor.vs') && !document.querySelector('.monaco-editor.vs-dark');
      const terms = [...state.terms.values()];
      const termLight = terms.length > 0 && terms.every((t) => t.term.options.theme.background === '#ffffff');
      const saved = (await api.settings.get()).settings.theme === 'light';
      await setThemeSetting('dark');
      await sleep(200);
      const bgDark = getComputedStyle(document.body).backgroundColor === 'rgb(20, 22, 26)';
      const monacoDark = !!document.querySelector('.monaco-editor.vs-dark') && !document.querySelector('.monaco-editor.vs');
      const ok = fontsLoaded && usesRoboto && attrLight && bgLight && monacoLight && termLight && saved && bgDark && monacoDark;
      return ok ? true : JSON.stringify({ fontsLoaded, usesRoboto, attrLight, bgLight, monacoLight, termLight, saved, bgDark, monacoDark });
    });

    await step('extra themes (high-contrast x2, night, nerd, tron, wargames) apply to the shell, Monaco and the terminal', async () => {
      const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const bad = [];
      for (const [name, bg] of [['high-contrast', '#000000'], ['high-contrast-light', '#ffffff'], ['night', '#1a130d'], ['nerd', '#000000'], ['tron', '#000000'], ['wargames', '#000000']]) {
        await setThemeSetting(name);
        await sleep(200);
        const attrOk = document.documentElement.dataset.theme === name;
        const bgOk = getComputedStyle(document.body).backgroundColor === hexToRgb(bg);
        // Monaco applies the custom theme's base type class (vs/vs-dark/hc-black/hc-light) to .monaco-editor, never
        // the custom theme id itself - so check the editor's actual rendered background color instead.
        const monacoBg = (document.querySelector('.monaco-editor-background') || {});
        const monacoOk = !!monacoBg.nodeType && getComputedStyle(monacoBg).backgroundColor === hexToRgb(bg);
        const terms = [...state.terms.values()];
        const termOk = terms.length > 0 && terms.every((t) => t.term.options.theme.background === TERM_THEMES[name].background);
        const saved = (await api.settings.get()).settings.theme === name;
        if (!(attrOk && bgOk && monacoOk && termOk && saved)) bad.push({ name, attrOk, bgOk, monacoOk, termOk, saved });
      }
      await setThemeSetting('dark');
      return bad.length ? JSON.stringify(bad) : true;
    });

    await step('theme button: a quick light/dark toggle, not a picker - high-contrast flips to its light twin, night/nerd/tron/wargames fall back to plain light', async () => {
      const clickAndGet = async () => { $('#btn-theme').click(); await sleep(200); return (await api.settings.get()).settings.theme; };
      const bad = [];
      const cases = [['dark', 'light'], ['light', 'dark'], ['high-contrast', 'high-contrast-light'], ['high-contrast-light', 'high-contrast'], ['night', 'light'], ['nerd', 'light'], ['tron', 'light'], ['wargames', 'light']];
      for (const [from, expected] of cases) {
        await setThemeSetting(from);
        await sleep(100);
        const got = await clickAndGet();
        if (got !== expected) bad.push({ from, expected, got });
      }
      await setThemeSetting('dark');
      return bad.length ? JSON.stringify(bad) : true;
    });

    await step('font picker: Settings -> Font switches the editor, every open terminal and --font-mono together, and the choice persists', async () => {
      const prev = (await api.settings.get()).settings;
      await openSettings();
      const sel = document.querySelector('#set-font-family');
      sel.value = 'jetbrains-mono'; sel.dispatchEvent(new Event('change'));
      [...document.querySelectorAll('#dialog button')].find((b) => b.textContent === 'Save').click();
      await sleep(300);
      const cssVarOk = /JetBrains Mono/.test(getComputedStyle(document.documentElement).getPropertyValue('--font-mono'));
      const editorOk = !editor || /JetBrains Mono/.test(editor.getOption(monaco.editor.EditorOption.fontInfo).fontFamily);
      const terms = [...state.terms.values()];
      const termOk = terms.length > 0 && terms.every((t) => /JetBrains Mono/.test(t.term.options.fontFamily));
      const saved = (await api.settings.get()).settings.monoFont === 'jetbrains-mono';
      await api.settings.save(prev);
      await loadProject();
      const restored = /Roboto Mono/.test(getComputedStyle(document.documentElement).getPropertyValue('--font-mono'));
      const ok = cssVarOk && editorOk && termOk && saved && restored;
      return ok ? true : JSON.stringify({ cssVarOk, editorOk, termOk, saved, restored });
    });

    await step('custom theme: a theme built at runtime from 3 seed colours via api.theme.derive (no CSS block at all, unlike every built-in theme) still paints the shell, Monaco and the terminal, and leaves no inline colours behind once you switch away from it', async () => {
      const seed = { bg: '#0a0e14', fg: '#c9d1d9', accent: '#58a6ff' };
      const derived = await api.theme.derive(seed);
      const theme = { id: 'custom-smoke-test', label: 'Smoke test theme', dark: derived.dark, seed, vars: derived.vars };
      const before = await api.settings.get();
      await api.settings.save({ ...before.settings, customThemes: [...(before.settings.customThemes || []), theme], theme: theme.id });
      await loadProject();
      await sleep(200);
      const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const attrOk = document.documentElement.dataset.theme === 'custom';
      const bgOk = getComputedStyle(document.body).backgroundColor === hexToRgb(theme.vars['--bg']);
      const monacoBg = (document.querySelector('.monaco-editor-background') || {});
      const monacoOk = !!monacoBg.nodeType && getComputedStyle(monacoBg).backgroundColor === hexToRgb(theme.vars['--bg']);
      const terms = [...state.terms.values()];
      const termOk = terms.length > 0 && terms.every((t) => t.term.options.theme.background === theme.vars['--bg']);
      await setThemeSetting('dark');
      await sleep(200);
      const cleared = getComputedStyle(document.body).backgroundColor === hexToRgb('#14161a') && document.documentElement.dataset.theme === 'dark';
      const after = await api.settings.get();
      await api.settings.save({ ...after.settings, customThemes: (after.settings.customThemes || []).filter((c) => c.id !== theme.id) });
      await loadProject();
      const ok = attrOk && bgOk && monacoOk && termOk && cleared;
      return ok ? true : JSON.stringify({ attrOk, bgOk, monacoOk, termOk, cleared });
    });

    await step('custom theme editor: Settings -> "Create custom theme…" previews live as the seed colours change, the fine-tune section overrides a generated colour, and Save/list/Delete round-trip through Settings', async () => {
      const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      await openSettings();
      [...document.querySelectorAll('#dialog button')].find((b) => b.textContent.includes('Create custom theme')).click();
      const opened = !!(await waitFor(() => /Create custom theme/.test($('#dialog h3').textContent), 3000));
      const [bgIn, fgIn, accentIn] = document.querySelectorAll('#dialog input[type=color]');
      const seed = { bg: '#101820', fg: '#e8e8e8', accent: '#ff6600' };
      bgIn.value = seed.bg; bgIn.dispatchEvent(new Event('input'));
      fgIn.value = seed.fg; fgIn.dispatchEvent(new Event('input'));
      accentIn.value = seed.accent; accentIn.dispatchEvent(new Event('input'));
      const previewed = !!(await waitFor(() => document.documentElement.dataset.theme === 'custom' && getComputedStyle(document.body).backgroundColor === hexToRgb(seed.bg), 3000));
      document.querySelector('#dialog details').open = true;
      const fineInputs = document.querySelectorAll('#dialog details input[type=color]');
      const fineShown = fineInputs.length >= 20;
      const overrideBg = '#223344';
      fineInputs[0].value = overrideBg; fineInputs[0].dispatchEvent(new Event('input'));
      const overridden = !!(await waitFor(() => getComputedStyle(document.body).backgroundColor === hexToRgb(overrideBg), 3000));
      document.querySelector('#dialog input[type=text]').value = 'Smoke UI Theme';
      [...document.querySelectorAll('#dialog .actions button')].find((b) => b.textContent.includes('Save theme')).click();
      const savedBackInSettings = !!(await waitFor(() => document.querySelector('#set-tab-general'), 3000));
      const listedInSettings = [...document.querySelectorAll('#dialog .agent-row')].some((r) => r.textContent.includes('Smoke UI Theme'));
      const cur = await api.settings.get();
      const savedTheme = (cur.settings.customThemes || []).find((c) => c.label === 'Smoke UI Theme');
      const persisted = !!savedTheme && savedTheme.vars['--bg'] === overrideBg && cur.settings.theme === savedTheme.id;
      const origConfirm = window.confirm;
      window.confirm = () => true; // this is the one window.confirm() in the app a smoke step deliberately drives
      try { [...document.querySelectorAll('#dialog .agent-row')].find((r) => r.textContent.includes('Smoke UI Theme')).querySelector('button.danger').click(); }
      finally { window.confirm = origConfirm; }
      const deleted = !!(await waitFor(async () => !(await api.settings.get()).settings.customThemes.some((c) => c.label === 'Smoke UI Theme'), 3000));
      $('#modal').classList.add('hidden');
      await setThemeSetting('dark');
      const ok = opened && previewed && fineShown && overridden && savedBackInSettings && listedInSettings && persisted && deleted;
      return ok ? true : JSON.stringify({ opened, previewed, fineShown, fineCount: fineInputs.length, overridden, savedBackInSettings, listedInSettings, persisted, deleted });
    });

    await step('icons resolve', async () => {
      const hasIcons = document.querySelectorAll('#topbar .i').length >= 6 && document.querySelectorAll('#side-tabs .i').length >= 5;
      const theme = document.querySelector('#btn-theme .i');
      return hasIcons && !!theme && window.icon.missing.length === 0 ? true : JSON.stringify({ hasIcons, theme: !!theme, missing: window.icon.missing });
    });

    await step('sidebar rail: aria-selected follows the active tab, a double-digit badge does not overrun its button, the splitter drag accounts for the rail', async () => {
      const rail = $('#side-tabs');
      setSideTab('agents');
      const agentsBtn = rail.querySelector('button[data-tab="agents"]');
      const filesBtn = rail.querySelector('button[data-tab="files"]');
      const ariaOk = agentsBtn.getAttribute('aria-selected') === 'true' && agentsBtn.tabIndex === 0 && filesBtn.getAttribute('aria-selected') === 'false' && filesBtn.tabIndex === -1;
      const panel = document.getElementById(agentsBtn.getAttribute('aria-controls'));
      const panelOk = !!panel && panel.classList.contains('active');
      setSideTab('files');

      const badge = $('#changes-count');
      const savedBadgeText = badge.textContent;
      badge.textContent = '(23)';
      const btnBox = agentsBtn.getBoundingClientRect(); // any rail button has the same width
      const badgeBox = $('#side-tabs button[data-tab="changes"] .badge').getBoundingClientRect();
      const badgeFits = badgeBox.right <= btnBox.right + 0.5 && badgeBox.left >= btnBox.left - 0.5;
      badge.textContent = savedBadgeText;

      const splitter = $('#split-side');
      const railW = rail.getBoundingClientRect().width;
      const savedSideW = document.documentElement.style.getPropertyValue('--side-w');
      splitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: railW + 260 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const newW = parseInt(document.documentElement.style.getPropertyValue('--side-w'), 10);
      const dragOk = Math.abs(newW - 260) <= 1;
      document.documentElement.style.setProperty('--side-w', savedSideW || '330px');

      const ok = ariaOk && panelOk && badgeFits && dragOk;
      return ok ? true : JSON.stringify({ ariaOk, panelOk, badgeFits, dragOk, newW });
    });

    await step('dialog focus: opening a modal moves focus inside it, Tab wraps, closing gives focus back to the opener', async () => {
      // a focus-restore check is meaningless without real window focus (a real user always has it while
      // interacting with the dialog) - this run can be launched without OS focus, so claim it explicitly first.
      window.focus();
      const opener = $('#btn-settings');
      opener.focus();
      await openSettings();
      const dialog = $('#dialog');
      // wireDialogFocus moves focus from a MutationObserver callback on the class change, not synchronously
      // within openSettings() - under load that callback can lag a flat sleep(0), so poll instead.
      let focusedInsideOnOpen = dialog.contains(document.activeElement);
      const end0 = Date.now() + 10000;
      while (!focusedInsideOnOpen && Date.now() < end0) { await sleep(50); focusedInsideOnOpen = dialog.contains(document.activeElement); }
      const items = [...dialog.querySelectorAll('input, textarea, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      last.focus();
      $('#modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const wrappedToFirst = document.activeElement === first;
      $('#modal').classList.add('hidden');
      // same race as the open side above: the close-branch focus restore also runs from the MutationObserver
      // callback, not synchronously here, so this needs the same poll instead of a single sleep(0).
      let restored = document.activeElement === opener;
      const end1 = Date.now() + 10000;
      while (!restored && Date.now() < end1) { await sleep(50); restored = document.activeElement === opener; }
      const ok = focusedInsideOnOpen && wrappedToFirst && restored;
      return ok ? true : JSON.stringify({ focusedInsideOnOpen, wrappedToFirst, restored, bodyHasFocus: document.hasFocus() });
    });

    await step('history graph + commit diff + blame', async () => {
      setSideTab('history');
      await refreshHistory();
      const rows = document.querySelectorAll('#side-history .row.commit').length;
      const svgs = document.querySelectorAll('#side-history .row.commit svg.graph circle.dot').length;
      // regression: many branch names on one commit used to wrap the row and squeeze the subject away
      const rowEls = [...document.querySelectorAll('#side-history .row.commit')];
      const noWrap = rowEls.every((r) => r.offsetHeight <= 26 && r.querySelectorAll('.ref').length <= 3);
      const subjectsVisible = rowEls.every((r) => r.querySelector('.c-sub').getBoundingClientRect().width >= 60);
      const overflowChip = rowEls.some((r) => [...r.querySelectorAll('.ref')].some((x) => /^\+\d+$/.test(x.textContent)));
      report.historyLayout = { noWrap, subjectsVisible, overflowChip };
      if (!noWrap || !subjectsVisible || !overflowChip) return false;
      const sha = state.history.data.commits[0].sha;
      await toggleCommit(sha);
      await waitFor(() => document.querySelector('#side-history .commit-detail .row.file'));
      const files = document.querySelectorAll('#side-history .commit-detail .row.file').length;
      await openCommitDiff(sha, state.history.info.files[0]);
      const tab = activeTab();
      const ro = !!tab && tab.ro === true && $('#diffbar').classList.contains('ro');
      const payloadClean = !sessionPayload().project.tabs.some((t) => t.rel === tab.rel && t.kind === 'diff' && state.tabs.find((x) => x.ro));
      await closeTab(tab.id);
      await api.fs.write(state.project.root, 'a.py', 'print("v2")\n'); // keep the fixture state
      await openFile('b.py');
      state.blame.on = true; state.blame.rel = null;
      await refreshBlame();
      const blamed = !!state.blame.lines && state.blame.lines.length === 3 && state.blame.lines[0].committed && !state.blame.lines[1].committed === false;
      state.blame.on = false; paintBlame();
      setSideTab('files');
      return rows >= 1 && svgs === rows && files >= 1 && ro && payloadClean && blamed ? true : JSON.stringify({ rows, svgs, files, ro, payloadClean, blamed, lines: state.blame.lines });
    });
    await step('stage one change from the diff', async () => {
      const before = (await api.fs.read(state.project.root, 'b.py')).content;
      await api.git.unstage(state.project.root, ['b.py']);
      await api.fs.write(state.project.root, 'b.py', 'one\nTWO\nthree\nfour\nFIVE\n'); // two separate changes against HEAD (one/two/three)
      await refreshChanges(); await reloadFromDisk();
      await openDiff('b.py');
      const st = () => state.changes.find((x) => x.path === 'b.py') || {};
      diffEditor.getModifiedEditor().setPosition({ lineNumber: 2, column: 1 });
      const first = await stageChangeAtCursor(false);
      await refreshChanges();
      const partly = st().staged === true && st().unstaged === true;           // only one of the two changes is in the index
      const cached = (await api.git.head(state.project.root, 'b.py')) !== undefined;
      diffEditor.getModifiedEditor().setPosition({ lineNumber: 4, column: 1 });
      const second = await stageChangeAtCursor(false);
      await refreshChanges();
      const fully = st().staged === true && st().unstaged === false;
      diffEditor.getModifiedEditor().setPosition({ lineNumber: 2, column: 1 });
      const back = await stageChangeAtCursor(true);
      await refreshChanges();
      const partlyAgain = st().staged === true && st().unstaged === true;
      await api.git.unstage(state.project.root, ['b.py']);
      await api.fs.write(state.project.root, 'b.py', before);
      await closeTabsFor('b.py'); await refreshChanges(); await reloadFromDisk();
      return first && partly && cached && second && fully && back && partlyAgain ? true : JSON.stringify({ first, partly, second, fully, back, partlyAgain, status: $('#status-left').textContent });
    });
    await step('command palette', async () => {
      openPalette();
      const open = !$('#quickopen').classList.contains('hidden') && document.querySelectorAll('#qo-list .qo-row').length > 15;
      $('#qo-input').value = 'show: history'; renderQuick();
      pickQuick(0);
      const went = state.sideTab === 'history';
      setSideTab('files');
      return open && went ? true : JSON.stringify({ open, went, tab: state.sideTab });
    });
    await step('run-this-test + test lenses', async () => {
      const m = await ensureModel('tests/test_x.py');
      const found = await api.tests.find('tests/test_x.py', m.model.getValue());
      const cmd = await api.tests.command({ rel: 'tests/test_x.py', name: 'test_x', kind: 'test', content: m.model.getValue() });
      const all = await api.tests.command({ rel: 'tests/test_x.py', all: true, content: m.model.getValue() });
      const ran = await api.tests.run({ rel: 'tests/test_x.py', all: true, content: m.model.getValue() });
      const ranOk = ran && !ran.error && ['passed', 'failed', 'unavailable', 'notfound'].includes(ran.status) && typeof ran.headline === 'string';
      const lensesRegistered = monaco.languages.getLanguages().some((l) => l.id === 'python');
      return found.length === 1 && found[0].line === 1 && /python -m pytest .*test_x\.py::test_x/.test(cmd.command) && /pytest/.test(all.command) && lensesRegistered && ranOk ? true : JSON.stringify({ found, cmd, all, ran });
    });
    await step('usage & insights: window opens with only what could be read, coverage marks appear for a covered file', async () => {
      await openInsights();
      const sections = [...document.querySelectorAll('[data-ins]')].map((e) => e.getAttribute('data-ins'));
      const need = ['Claude plan limits', 'Dependency problems', 'Code quality (SonarCloud)', 'Running Spring app (Actuator)', 'Test coverage in the editor'];
      const missing = need.filter((n) => !sections.includes(n));
      $('#modal').classList.add('hidden');
      const cov = await api.insights.coverage('tests/test_x.py');
      const covOk = cov && !cov.error && (cov.none === true || Array.isArray(cov.covered));
      return !missing.length && covOk ? true : JSON.stringify({ sections, missing, cov });
    });
    await step('click-through: Copilot row, Run test lens, insights buttons, coverage marks, What’s new, other editor, away + undo dialogs', async () => {
      const bad = [];
      // 1. Setup & health → "I use Copilot" really switches it on, and the row then offers the usage button
      await openDoctor();
      const btn = document.querySelector('[data-health="copilot"] button') || (() => { document.querySelector('details summary') && [...document.querySelectorAll('details')].forEach((d) => { d.open = true; }); return document.querySelector('[data-health="copilot"] button'); })();
      if (!btn) bad.push('copilot row has no button'); else {
        btn.click();
        const on = await waitFor(() => state.project.config.copilot && state.project.config.copilot.enabled === true, 8000);
        if (!on) bad.push('copilot not switched on');
        const row = await waitFor(() => { const b = document.querySelector('[data-health="copilot"] button'); return b && /Open my usage/.test(b.textContent) ? b : null; }, 8000);
        if (!row) bad.push('copilot usage button missing');
      }
      $('#modal').classList.add('hidden');
      // 2. the Run test command (what the lens click calls) gives a verdict and a result lens entry
      const m = await ensureModel('tests/test_x.py');
      await openFile('tests/test_x.py');
      const t = (await api.tests.find('tests/test_x.py', m.model.getValue())).find((x) => x.kind === 'test');
      await runTestFor('tests/test_x.py', t, false);
      const verdict = testResults.get(testKey('tests/test_x.py', t, false));
      if (!verdict || !['passed', 'failed', 'notfound', 'unavailable', 'timeout'].includes(verdict.status)) bad.push(`run test verdict: ${JSON.stringify(verdict && verdict.status)}`);
      if (verdict && verdict.status !== 'passed' && !document.querySelector('#dialog .test-verdict')) bad.push('no result dialog for a non-pass');
      $('#modal').classList.add('hidden');
      // 3. insights: the on-demand buttons answer in plain words
      await openInsights();
      const press = async (section) => { const b = document.querySelector(`[data-ins="${section}"] button`); b.click(); return waitFor(() => { const o = document.querySelector(`[data-ins="${section}"] .ins-out`); return o && o.textContent && !/Checking/.test(o.textContent) ? o.textContent : null; }, 15000); };
      const act = await press('Running Spring app (Actuator)');
      if (!act || !/Nothing answered|UP|DOWN/.test(act)) bad.push(`actuator: ${act}`);
      const dep = await press('Dependency problems');
      if (!dep) bad.push('dependency check gave no answer');
      $('#modal').classList.add('hidden');
      // 4. coverage marks
      await api.smokeExternalWrite('lcov.info', 'SF:tests/test_x.py\nDA:1,1\nend_of_record\n');
      coverage.on = false; toggleCoverage();
      const marked = await waitFor(() => coverage.deco && coverage.deco.length > 0, 8000);
      if (!marked) bad.push('no coverage marks');
      toggleCoverage();
      // 5. What's new, the other editor, away + undo
      await openWhatsNew();
      if (!document.querySelector('#dialog .whatsnew')) bad.push('whats new empty');
      $('#modal').classList.add('hidden');
      const oe = await api.editor.open({ rel: 'tests/test_x.py', line: 1, which: 'vscode' });
      if (!(oe && (oe.opened || /VS Code was not found/.test(oe.error || '')))) bad.push(`open in editor: ${JSON.stringify(oe)}`);
      await openAway(); await openUndo();
      if (!/Undo a merged run/.test(document.querySelector('#dialog h3') ? document.querySelector('#dialog h3').textContent : '') && !$('#status-left').textContent) bad.push('undo dialog neither opened nor explained');
      $('#modal').classList.add('hidden');
      return bad.length ? JSON.stringify(bad) : true;
    });
    await step('language server (fake) → hover, definition, references, completion, diagnostics', async () => {
      await openFile('b.py');
      const m = state.models.get('b.py');
      const live = await waitFor(() => lspSt.docs.has('b.py'), 8000);
      m.model.setValue('def target():\n    return BAD\ntarget()\n');
      const marks = await waitFor(() => { const mk = monaco.editor.getModelMarkers({ resource: m.model.uri, owner: 'lsp' }); return mk.length ? mk : null; }, 8000);
      const hover = await lspHoverAt(m.model, new monaco.Position(1, 6));
      const defs = await lspLocationsAt(m.model, new monaco.Position(3, 2), 'definition');
      const refs = await lspLocationsAt(m.model, new monaco.Position(1, 6), 'references');
      const comp = await lspCompletionsAt(m.model, new monaco.Position(1, 1));
      const sig = await lspSignatureAt(m.model, new monaco.Position(3, 8));
      m.model.setValue('def target():\n    return 1\ntarget()\n');
      const cleared = await waitFor(() => monaco.editor.getModelMarkers({ resource: m.model.uri, owner: 'lsp' }).length === 0, 6000);
      const statusText = $('#status-lsp').textContent;
      m.model.setValue(m.saved);
      const ok = live && marks && marks[0].message === 'fake: BAD found' && marks[0].startLineNumber === 2
        && hover && /fake\*\*: target/.test(hover.contents[0].value)
        && defs && defs.length === 1 && defs[0].uri.path === '/b.py' && defs[0].range.startLineNumber === 1
        && refs && refs.length === 2 && comp && comp.suggestions[0].label === 'fakeCompletion' && sig && sig.value.signatures[0].label === 'fake(a, b)'
        && cleared && /python language server/.test(statusText);
      await closeTabsFor('b.py');
      return ok ? true : JSON.stringify({ live, marks: marks && marks.length, hover: !!hover, defs, refs: refs && refs.length, comp: !!comp, sig: !!sig, cleared, statusText });
    });
    await step('fix loop toggle, font size, memory', async () => {
      $('#fixloop').checked = true; $('#fixloop').dispatchEvent(new Event('change'));
      await sleep(400);
      const on = (await api.settings.get()).settings.fixLoop.enabled === true && state.project.config.fixLoop.enabled === true;
      $('#fixloop').checked = false; $('#fixloop').dispatchEvent(new Event('change'));
      await sleep(400);
      const off = (await api.settings.get()).settings.fixLoop.enabled === false;
      await changeFontSize(2);
      const bigger = editor.getOption(monaco.editor.EditorOption.fontSize) === 15;
      await changeFontSize(0);
      const reset = editor.getOption(monaco.editor.EditorOption.fontSize) === 13;
      const mem = await api.memory();
      await pollMemory();
      return on && off && bigger && reset && mem.mb > 20 && /MB|GB/.test($('#status-mem').textContent) ? true : JSON.stringify({ on, off, bigger, reset, mem, text: $('#status-mem').textContent });
    });

    await step('fix loop end to end (idle → gates → prompt back → stop)', async () => {
      const cur = await api.settings.get();
      const prevSettings = cur.settings;
      await api.settings.save({ ...prevSettings, fixLoop: { enabled: true, maxRounds: 3, idleSeconds: 2, tier: 'fast', include: 'error' } });
      await loadProject();
      const a0 = (await api.fs.read(state.project.root, 'a.py')).content;
      await api.fs.write(state.project.root, 'a.py', 'print("v3")\n'); // a changed .py file, so the demo gate (match *.py) runs
      await api.fs.write(state.project.root, 'fake-agent.js', "const chunk = 'working on it '.repeat(40);\nconsole.log(chunk);\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', (d) => { console.log(d.includes('automatic quality gate') ? 'GOT:PROMPT' : 'GOT:other'); console.log(chunk); });\n");
      const events = [];
      const off = api.fixloop.onStatus((e) => events.push(e.state));
      const entry = await newTerminal({ title: 'fake agent', initialInput: 'node fake-agent.js\r', watch: true, label: 'Fake agent' });
      const text = () => { const buf = entry.term.buffer.active; return Array.from({ length: buf.length }, (_, n) => (buf.getLine(n) ? buf.getLine(n).translateToString(true) : '')).join('\n'); };
      let result = null;
      if (entry.id !== null) {
        const fixing = await waitFor(() => events.includes('fixing'), 20000);
        const gotPrompt = await waitFor(() => text().includes('GOT:PROMPT'), 8000);
        const stopped = await waitFor(() => events.includes('stop'), 20000);
        const badge = entry.fix && entry.fix.state === 'stop' && /no progress/.test(entry.fix.reason);
        result = { fixing: !!fixing, gotPrompt: !!gotPrompt, stopped: !!stopped, badge: !!badge, events: events.join(',') };
      }
      off();
      closeTerminal(entry.key);
      await api.fs.write(state.project.root, 'a.py', a0);
      await api.git.revert(state.project.root, 'fake-agent.js');
      await api.settings.save(prevSettings);
      await loadProject(); await refreshChanges();
      if (!result) return 'pty unavailable';
      return result.fixing && result.gotPrompt && result.stopped && result.badge ? true : JSON.stringify(result);
    });

    await step('auto-merge: a clean run by an agent with a strong track record for this kind of task merges itself', async () => {
      // scripts/smoke.js seeded 3 prior "docs"-kind wins for the agent "Smoke" (scorecard.js's MIN_RUNS), so a 4th
      // clean one should clear automerge.autoMergeEligible()'s bar without needing to fabricate a scorecard here.
      const mainRoot = state.project.root;
      // main carries the fixture's own uncommitted a.py/b.py edits for most of this suite - mergeRun refuses into
      // a dirty main, so set them aside for the real merge this step exercises and put the exact bytes back after.
      await refreshChanges();
      const stashed = await Promise.all(state.changes.map(async (c) => ({ path: c.path, content: (await api.fs.read(state.project.root, c.path)).content })));
      for (const f of stashed) await api.git.revert(state.project.root, f.path);
      const restore = async () => { for (const f of stashed) await api.fs.write(state.project.root, f.path, f.content); await refreshChanges(); };
      const cur = await api.settings.get();
      const prevSettings = cur.settings;
      await api.settings.save({ ...prevSettings, fixLoop: { enabled: true, maxRounds: 3, idleSeconds: 2, tier: 'fast', include: 'error' }, autoMerge: { enabled: true, minWinRate: 0.8 } });
      await loadProject();
      const events = [];
      const offStatus = api.fixloop.onStatus((e) => events.push(e.state));
      let merged = null;
      const offMerged = api.runs.onAutoMerged((e) => { merged = e; });
      // "echo smoke" exits in a few ms, well under idleSeconds: the pty's own exit handler unregisters it from the
      // fix loop before idle ever gets a chance to fire. Use a process that stays alive and goes idle instead, like
      // the "fix loop end to end" step above does with fake-agent.js - and print well over IdleDetector's minBytes
      // (400) first, or poll() never considers it busy enough to ever call it idle. 80 reps (~480 bytes) once sat
      // close enough to that floor that shell/pty startup noise could occasionally eat into the margin and leave
      // idle-detection never firing at all (a flakier, load-sensitive variant of the same thing) - 400 reps leaves
      // no realistic room for that.
      const r = await startRun({ task: 'update the docs for this module', name: 'automerge docs', agent: { name: 'Smoke', command: "node -e \"console.log('smoke '.repeat(400)); process.stdin.resume();\"" }, allow: '**' });
      if (!r) { offStatus(); offMerged(); await api.settings.save(prevSettings); await restore(); return 'start failed'; }
      await api.fs.write(state.project.root, 'automerge-notes.md', '# notes\n'); // not a .py file: the demo gate (match *.py) stays quiet, so the gates come back clean
      await refreshChanges();
      if (r.entry && r.entry.id !== null) {
        await waitFor(() => events.includes('done') || merged, 20000);
        await waitFor(() => merged, 8000);
      }
      offStatus(); offMerged();
      // on success the merge already removed the run's worktree while this was still the active root (tryAutoMerge
      // runs unattended, before anyone switches away) - project:switch now lists from the target rather than the
      // current root for exactly this case, so this still succeeds even though the old root no longer exists on disk.
      await api.runs.switchTo(mainRoot);
      if (!merged) await api.runs.discard(r.run.id, 'skip');
      await api.settings.save(prevSettings);
      await loadProject(); await refreshChanges(); await refreshRuns();
      await restore();
      if (!r.entry || r.entry.id === null) return 'pty unavailable';
      return merged && merged.id === r.run.id ? true : JSON.stringify({ events, merged });
    });

    await step('auto-merge dry run: logs what would have merged (and the merge dialog agrees it is "Safe to merge"), but never actually merges', async () => {
      const mainRoot = state.project.root;
      await refreshChanges();
      const stashed = await Promise.all(state.changes.map(async (c) => ({ path: c.path, content: (await api.fs.read(state.project.root, c.path)).content })));
      for (const f of stashed) await api.git.revert(state.project.root, f.path);
      const restore = async () => { for (const f of stashed) await api.fs.write(state.project.root, f.path, f.content); await refreshChanges(); };
      const cur = await api.settings.get();
      const prevSettings = cur.settings;
      // 'unreviewed' is deliberately off here, not just for autoMerge's own unattended guard check: the merge
      // dialog's own guard call is interactive (not unattended), so without this a human-facing "mark it reviewed"
      // nudge would correctly hold the verdict at "caution" even for a run tryAutoMerge is about to wave through -
      // that is real, intentional behaviour (see verdict.js), not something this step should be fighting to get
      // around just to see the "ready" case; turning the one rule off here is the honest way to test it instead.
      await api.settings.save({ ...prevSettings, fixLoop: { enabled: true, maxRounds: 3, idleSeconds: 2, tier: 'fast', include: 'error' }, autoMerge: { enabled: true, dryRun: true, minWinRate: 0.8 }, mergeGuard: { unreviewed: 'off' } });
      await loadProject();
      const events = [];
      const offStatus = api.fixloop.onStatus((e) => events.push(e.state));
      let merged = null;
      const offMerged = api.runs.onAutoMerged((e) => { merged = e; });
      const r = await startRun({ task: 'update the docs for this module once more', name: 'automerge dry run', agent: { name: 'Smoke', command: "node -e \"console.log('smoke '.repeat(400)); process.stdin.resume();\"" }, allow: '**' });
      if (!r) { offStatus(); offMerged(); await api.settings.save(prevSettings); await restore(); return 'start failed'; }
      await api.fs.write(state.project.root, 'automerge-dryrun-notes.md', '# notes\n'); // not .py: stays clean of the demo gate, same reasoning as the real auto-merge step above
      await refreshChanges();
      let verdictReady = false; let stillThere = false;
      if (r.entry && r.entry.id !== null) {
        await waitFor(() => events.includes('done'), 20000);
        await refreshRuns();
        stillThere = state.runs.runs.some((x) => x.id === r.run.id);
        if (stillThere) {
          // tryAutoMerge runs right after 'done' (dry run logs instead of merging), and the dialog's own verdict
          // redoes the guard+scorecard check from scratch - both can lag behind a fixed delay under heavy load
          // (the flaky "stuck verdictReady: false" case this retry loop replaces a single fixed-delay snapshot for).
          const end = Date.now() + 15000;
          while (Date.now() < end && !verdictReady) {
            await mergeRunDialog(r.run);
            verdictReady = !!document.querySelector('#dialog .guard-row.verdict.ok');
            $('#modal').classList.add('hidden');
            if (!verdictReady) await sleep(500);
          }
        }
      }
      offStatus(); offMerged();
      // tryAutoMerge (main process: guard+scorecard, then the journal write) runs as its own async chain off the
      // same 'done' event, signalled to nothing the renderer awaits - same "can lag behind under load" reasoning
      // as the verdictReady retry above, so this also polls instead of reading the journal exactly once.
      let dryRunLogged = false;
      if (stillThere) {
        // the idle-detect -> real quality-gate checks -> 'done' -> tryAutoMerge -> journal-write chain this polls
        // for all runs on the main process's single event loop, competing with every other IPC handler - under
        // heavy load the whole chain can take much longer than the verdictReady retry above already assumed.
        const end2 = Date.now() + 30000;
        while (Date.now() < end2 && !dryRunLogged) {
          const replayed = await api.runs.replay(r.run.id);
          dryRunLogged = (replayed.steps || []).some((s) => s.kind === 'automerge-dryrun');
          if (!dryRunLogged) await sleep(500);
        }
      }
      await switchRoot(mainRoot);
      if (stillThere) await api.runs.discard(r.run.id, 'skip');
      await api.settings.save(prevSettings);
      await loadProject(); await refreshChanges(); await refreshRuns();
      await restore();
      if (!r.entry || r.entry.id === null) return 'pty unavailable';
      return !merged && stillThere && verdictReady && dryRunLogged ? true : JSON.stringify({ merged, stillThere, verdictReady, dryRunLogged, events });
    });

    await step('switching project with a diff open does not throw (regression: TextModel disposed before DiffEditorWidget model reset)', async () => {
      await openDiff('a.py');
      await openFile('b.py');
      await openDiff('a.py');
      const before = errors.length;
      await resetWorkspace({ keepTerminals: true });
      await sleep(400);
      const cleared = !diffEditor.getModel() && state.tabs.length === 0;
      await loadProject();
      return cleared && errors.length === before;
    });

    await step('fleet panel: context meter, blowout warning, waiting/stale states, filter, timeline', async () => {
      setSideTab('agents');
      const mk = (key, o) => ({ key, title: key, agent: { command: 'claude' }, startedAt: Date.now() - 600000, lastData: Date.now() - 1000, exited: false, ...o });
      const fake = [
        mk('smoke-full', { local: { context: 8192, model: 'qwen3:14b', proxy: { token: 'x' } }, fleet: { lastInput: 8000, totalInput: 24000, totalOutput: 1200, requests: 4, model: 'qwen3:14b' }, events: [{ at: Date.now(), kind: 'model', text: 'model request: 8000 in / 90 out' }] }),
        mk('smoke-wait', { prompt: { text: 'Allow edit?', at: Date.now() } }),
        mk('smoke-stale', { lastData: Date.now() - 9 * 60000 }),
        mk('smoke-armed', { runId: 'smoke-armed-run' }),
        mk('smoke-cloud', { fleet: { model: 'claude-sonnet-5', cloud: { input: 500, output: 300, cacheRead: 7000, cacheCreate: 1200, messages: 3, lastContext: 8700, model: 'claude-sonnet-5' } } }),
      ];
      for (const t of fake) state.terms.set(t.key, t);
      // runs:list's autoMergeArmed (main.js) reaches the card through fleetSnapshot() -> api.fleetView() -> fleet.row();
      // faking state.runs.runs directly here is the join point, same as the real refreshRuns() response would be.
      const savedRuns = state.runs;
      state.runs = { ...(state.runs || {}), runs: [...((state.runs && state.runs.runs) || []), { id: 'smoke-armed-run', autoMergeArmed: true }] };
      try {
        await renderFleet();
        const cards = document.querySelectorAll('#a-fleet .fl-card');
        const full = [...cards].find((c) => c.textContent.includes('smoke-full'));
        const ok1 = cards.length >= 3 && !!full && full.classList.contains('blow') && /98% of 8k/.test(full.textContent);
        const ok2 = [...cards].some((c) => c.classList.contains('st-waiting') && c.textContent.includes('needs approval')) && [...cards].some((c) => c.classList.contains('st-stale'));
        fleetUi.filter = 'blowouts'; await renderFleet();
        const only = document.querySelectorAll('#a-fleet .fl-card').length === 1;
        fleetUi.filter = 'all'; fleetUi.open.add('smoke-full'); await renderFleet();
        const timeline = !!document.querySelector('#a-fleet .fl-events .fl-ev');
        const armedCard = [...document.querySelectorAll('#a-fleet .fl-card')].find((c) => c.textContent.includes('smoke-armed'));
        const armed = !!armedCard && !!armedCard.querySelector('.chip.armed') && /auto-merge armed/.test(armedCard.textContent);
        const notArmed = !full.querySelector('.chip.armed'); // a run with no autoMergeArmed never gets the chip
        fleetUi.open.add('smoke-cloud'); await renderFleet();
        const cloudCard = [...document.querySelectorAll('#a-fleet .fl-card')].find((c) => c.textContent.includes('smoke-cloud'));
        const cloudBreakdown = !!cloudCard && cloudCard.textContent.replace(/\s+/g, ' ').includes('500 new in · 7k cache read · 1k cache write · 300 out');
        return ok1 && ok2 && only && timeline && armed && notArmed && cloudBreakdown ? true : JSON.stringify({ ok1, ok2, only, timeline, armed, notArmed, cloudBreakdown, cards: cards.length, text: full && full.textContent });
      } finally { for (const t of fake) state.terms.delete(t.key); fleetUi.open.clear(); fleetUi.filter = 'all'; state.runs = savedRuns; await renderFleet(); }
    });

    await step('board columns and best-of dialog', async () => {
      const savedRuns = state.runs; const savedView = fleetUi.view;
      try {
        state.runs = { runs: [{ id: 'b1', name: 'working', files: 1, agent: 'x' }, { id: 'b2', name: 'asks', files: 0, agent: 'x' }, { id: 'b3', name: 'finished', files: 3, agent: 'x' }], current: '', main: null };
        fleetUi.view = { rows: [{ runId: 'b1', state: 'running', pct: 0.5, level: 'ok' }, { runId: 'b2', state: 'waiting', pct: null }, { runId: 'b3', state: 'exited', pct: null }] };
        boardUi.open = true; $('#board').classList.remove('hidden'); renderBoard();
        const n = (c) => document.querySelectorAll(`#board .bd-${c} .bd-card`).length;
        const columns = n('running') === 1 && n('needs') === 1 && n('review') === 1 && !!document.querySelector('#board .bd-backlog');
        closeBoard();
        const hidden = $('#board').classList.contains('hidden');
        const agents = (state.project.config && state.project.config.agents) || [];
        let dialog = true;
        if (agents.length) {
          openBestOf({ task: 'smoke task' });
          dialog = !!$('#bo-task') && $('#bo-task').value === 'smoke task' && document.querySelectorAll('#dialog .bo-n').length === agents.length && !!$('#bo-start');
          $('#modal').classList.add('hidden');
        }
        return columns && hidden && dialog ? true : JSON.stringify({ columns, hidden, dialog });
      } finally { state.runs = savedRuns; fleetUi.view = savedView; boardUi.open = false; $('#board').classList.add('hidden'); }
    });

    await step('markdown preview draws mermaid diagrams safely (and shows a broken one as an error)', async () => {
      const md = '# D\n\n```mermaid\nflowchart LR\n  A[Start] --> B{Check <img src=x onerror=window.__mmdPwned=1>}\n  B --> C[Done]\n```\n\n```mermaid\nthis is not a diagram\n```\n';
      await api.fs.write(state.project.root, 'diagram-preview.md', md);
      await openFile('diagram-preview.md');
      if ($('#md-preview').classList.contains('hidden')) toggleMarkdownPreview(); // the previous step left the editor showing
      const drawn = await waitFor(() => document.querySelector('#md-preview .md-mermaid svg'), 15000);
      const failed = await waitFor(() => document.querySelector('#md-preview .md-mermaid-error .hint'), 15000);
      await sleep(300);
      const safe = !window.__mmdPwned && !document.querySelector('#md-preview .md-mermaid script, #md-preview .md-mermaid foreignObject');
      return drawn && failed && safe ? true : JSON.stringify({ drawn: !!drawn, failed: !!failed, safe, html: (document.querySelector('#md-preview') || {}).innerHTML?.slice(0, 300) });
    });

    await step('an ACP agent streams text and tool cards, asks permission, finishes its turn (and capture records it as shapes)', async () => {
      await api.capture.clear(); const capOn = (await api.capture.toggle(true)).enabled;
      try {
        const entry = await launchAcp({ id: 'smoke-acp', name: 'smoke acp', root: state.project.root }, { name: 'Smoke ACP', protocol: 'acp', policy: 'ask' }, 'hello', { enabled: false });
        const card = await waitFor(() => entry.log.querySelector('.acp-perm button.primary'), 15000);
        const sawText = /help you/.test(entry.log.textContent);
        const tool = !!entry.log.querySelector('.acp-tool');
        if (card) card.click();
        const done = await waitFor(() => /turn finished/.test(entry.log.textContent), 20000);
        const after = /successfully updated/.test(entry.log.textContent);
        api.acp.cancel(entry.id);
        const cap = await api.capture.status(); // capture was on while the agent talked: its messages were written (as shapes), and nothing without the switch
        await api.capture.toggle(false); await api.capture.clear();
        const capOk = capOn && cap.kinds.acp > 5 && (await api.capture.status()).total === 0;
        return card && sawText && tool && done && after && capOk ? true : JSON.stringify({ card: !!card, sawText, tool, done: !!done, after, capOn, cap: cap.kinds, log: entry.log.textContent.slice(0, 300) });
      } finally { await api.capture.toggle(false); }
    });

    await step('scorecard: discarded runs are recorded per kind of task (lost vs discarded; nothing for an untouched run), and a hand-over starts the stronger agent in the same run', async () => {
      await api.scorecard.clear();
      const mainRoot = state.project.root;
      const mk = async (name, task) => { const r = await api.runs.create({ name, task, agent: 'Echo', allow: '' }); return r.run; };
      const doneRun = await mk('sc discard', 'Write unit tests for the parser');
      await switchRoot(doneRun.root); await api.fs.write(state.project.root, 'sc-merged.txt', 'x\n'); await switchRoot(mainRoot);
      const m = await api.runs.discard(doneRun.id); // (the smoke project's main tree is dirty, so a merge is refused here)
      const lostRun = await mk('sc lost', 'Write unit tests for the parser');
      await switchRoot(lostRun.root); await api.fs.write(state.project.root, 'sc-lost.txt', 'x\n'); await switchRoot(mainRoot);
      await api.runs.discard(lostRun.id, 'lost');
      const idle = await mk('sc idle', 'Write unit tests for the parser'); // thrown away at once: not a data point
      await api.runs.discard(idle.id);
      const data = await api.scorecard.get();
      const row = (data.rows || []).find((r) => r.agent === 'Echo' && r.kind === 'tests');
      await openScorecard();
      const shown = !!document.querySelector('#dialog .sc-table') && /Tests/.test($('#dialog').textContent) && /Echo/.test($('#dialog').textContent) && /Cost per merge/.test($('#dialog').textContent);
      // "adaptive guard rules" above recorded 3 real protectedPaths overrides via the merge API - the scorecard
      // screen's "Guard overrides" table should be showing that count by now, fed from the same guardoverrides.json
      // the suggestion logic already tracks (no separate persistence to test).
      const ovTable = [...document.querySelectorAll('#dialog .sc-table')].find((t) => /Times overridden/.test(t.querySelector('thead').textContent));
      const ovRow = ovTable && [...ovTable.querySelectorAll('tbody tr')].find((tr) => /Protected files changed/.test(tr.textContent));
      const overridesShown = !!ovRow && /\b3\b/.test(ovRow.textContent);
      $('#modal').classList.add('hidden');
      const kindOk = (await api.scorecard.kind('Fix the NullPointerException in the login')) === 'bugfix';
      // hand-over: the window starts the named agent inside the same run
      const run = await mk('sc handover', 'Add a postcode check');
      await refreshRuns();
      const before = state.terms.size;
      await handleEscalation({ from: null, runId: run.id, root: run.root, agent: 'NoResume', prompt: 'You are taking over a task.' });
      const t = [...state.terms.values()].find((x) => x.runId === run.id && x.agent === 'NoResume');
      const started = !!t && state.terms.size === before + 1;
      if (t && t.id !== null) { api.pty.kill(t.id); }
      await sleep(300);
      await api.runs.discard(run.id, 'skip');
      await refreshRuns();
      await api.scorecard.clear();
      return !m.error && row && row.runs === 2 && row.failed === 1 && row.lost === 1 && data.total === 2 && shown && overridesShown && kindOk && started ? true : JSON.stringify({ m: m.error, row, total: data.total, shown, overridesShown, kindOk, started });
    });

    await step('CLI-adjacent features in the window: Claude Code version status, container setup state, per-run container checkbox', async () => {
      const dr = await api.drift.status();
      const cs = await api.container.setup();
      openRunDialog({ task: 'x' });
      await sleep(400);
      const box = document.querySelector('#run-container');
      const hasBox = !!box;
      $('#modal').classList.add('hidden');
      return dr && typeof dr.text === 'string' && cs && ['install', 'build', 'enable', 'ready'].includes(cs.step) && hasBox ? true : JSON.stringify({ dr, cs, hasBox });
    });

    await step('Setup & health: rows with plain wording and a button per problem, the Jev key dialog, the walkthrough, and “?” help in the settings', async () => {
      await openDoctor();
      for (let i = 0; i < 40 && !document.querySelector('#dialog [data-health="claude"]'); i++) await sleep(250);
      const rows = [...document.querySelectorAll('#dialog .health-row')].map((r) => r.dataset.health);
      const summary = ($('#health-summary') || {}).textContent || '';
      const jevBtn = document.querySelector('#dialog [data-health="jev"] button');
      if (jevBtn) jevBtn.click();
      await sleep(500);
      const jevDlg = /Smarter task recognition/.test($('#dialog').textContent) && !!document.querySelector('#dialog input[type=password]');
      const noKey = await api.jev.saveKey({ key: '' });
      await openWalkthrough(0);
      for (let i = 0; i < 40 && !document.querySelector('#dialog .walk-choice') && !/No agent is set up/.test($('#dialog').textContent); i++) await sleep(250);
      const walk = /Welcome to Bazinga/.test($('#dialog').textContent);
      await openWalkthrough(1);
      const start = !!document.querySelector('#walk-start');
      $('#modal').classList.add('hidden');
      await openSettings();
      await sleep(400);
      const help = document.querySelectorAll('#dialog .help-q').length;
      const q = document.querySelector('#dialog .help-q'); if (q) q.click();
      const shown = !!document.querySelector('#dialog .help-text');
      $('#modal').classList.add('hidden');
      return rows.includes('claude') && rows.includes('docker') && rows.includes('jev') && summary.length > 10 && jevDlg && noKey.error && walk && start && help >= 4 && shown ? true : JSON.stringify({ rows, summary, jevDlg, noKey, walk, start, help, shown });
    });

    api.smokeStep('steps done');
    // leave the UI in a representative state (diff open, changes + problems visible) for the optional screenshot
    await openDiff('a.py');
    api.smokeStep('final diff open');
    try { setSideTab('changes'); showBottom('problems'); await sleep(700); } catch (err) { errors.push(`final state: ${err && err.stack || err}`); }
    api.smokeStep('reporting');
    report.ok = errors.length === 0 && Object.values(report.steps).every((v) => v === 'ok' || v === 'pty unavailable');
    api.smokeDone(report);
  }
})();
