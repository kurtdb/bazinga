'use strict';

// Every rebindable chord in Bazinga (Settings -> Keyboard), in command-palette order. "Mod" is the
// platform's primary modifier - Cmd on macOS, Ctrl elsewhere - so one default chord works on both
// without special-casing a platform here; the renderer resolves "Mod" against the real key event.
const DEFAULT_KEYBINDINGS = [
  { id: 'goToFile', title: 'Go to file…', chord: 'Mod+P' },
  { id: 'goToSymbol', title: 'Go to symbol in workspace…', chord: 'Mod+T' },
  { id: 'commandPalette', title: 'Command palette…', chord: 'Mod+Shift+P' },
  { id: 'focusSearch', title: 'Show: Search in project', chord: 'Mod+Shift+F' },
  { id: 'saveFile', title: 'Save file', chord: 'Mod+S' },
  { id: 'newTerminal', title: 'New terminal', chord: 'Ctrl+`' },
];

const MOD_ORDER = ['Mod', 'Ctrl', 'Shift', 'Alt'];

/** Canonicalizes a chord's modifier order and key case ("shift+mod+p" -> "Mod+Shift+P"), or null if it has no real key. */
function normalizeChord(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const mods = new Set();
  let key = null;
  for (const part of raw.split('+').map((p) => p.trim()).filter(Boolean)) {
    const mod = MOD_ORDER.find((m) => m.toLowerCase() === part.toLowerCase());
    if (mod) mods.add(mod);
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  return key ? [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+') : null;
}

/** Merges user overrides (commandId -> chord, or null to unbind) over the defaults. Unknown ids are ignored. */
function resolve(overrides) {
  const known = new Set(DEFAULT_KEYBINDINGS.map((k) => k.id));
  const out = {};
  for (const { id, chord } of DEFAULT_KEYBINDINGS) out[id] = normalizeChord(chord);
  for (const [id, chord] of Object.entries(overrides || {})) {
    if (known.has(id)) out[id] = chord === null ? null : normalizeChord(chord);
  }
  return out;
}

/** Commands left sharing the same chord after resolving, grouped by chord (unbound commands never conflict). */
function findConflicts(resolved) {
  const byChord = new Map();
  for (const [id, chord] of Object.entries(resolved)) {
    if (!chord) continue;
    if (!byChord.has(chord)) byChord.set(chord, []);
    byChord.get(chord).push(id);
  }
  return [...byChord.entries()].filter(([, ids]) => ids.length > 1).map(([chord, ids]) => ({ chord, ids }));
}

module.exports = { DEFAULT_KEYBINDINGS, normalizeChord, resolve, findConflicts };
