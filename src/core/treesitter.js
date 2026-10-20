'use strict';
/**
 * Symbols (classes, methods, functions) from a real parser: web-tree-sitter with prebuilt grammars (vendor/tree-sitter-wasms, copied from the tree-sitter-wasms package; see the README there). It reads
 * declarations over several lines, annotations on their own line, nested classes and syntax errors in other places; the line patterns
 * in symbols.js miss those. Returns null when the language is not supported or the parser cannot start, and the caller falls back to
 * the line patterns. Same result shape as symbols.findSymbols.
 */
const path = require('node:path');
const fs = require('node:fs');

const EXT = { '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'tsx', '.py': 'python', '.go': 'go', '.rs': 'rust', '.cs': 'c_sharp' };
const MAX_BYTES = 2 * 1024 * 1024;

const FUNCTION_VALUE = new Set(['arrow_function', 'function_expression', 'function']);
const RULES = {
  java: { class: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration'], method: ['method_declaration', 'constructor_declaration'] },
  kotlin: { class: ['class_declaration', 'object_declaration'], function: ['function_declaration'], asMethodInClass: true },
  javascript: { class: ['class_declaration', 'abstract_class_declaration'], method: ['method_definition'], function: ['function_declaration', 'generator_function_declaration'], arrowVars: true },
  typescript: { class: ['class_declaration', 'abstract_class_declaration', 'interface_declaration'], method: ['method_definition'], function: ['function_declaration', 'generator_function_declaration'], arrowVars: true },
  tsx: { class: ['class_declaration', 'abstract_class_declaration', 'interface_declaration'], method: ['method_definition'], function: ['function_declaration', 'generator_function_declaration'], arrowVars: true },
  python: { class: ['class_definition'], function: ['function_definition'], asMethodInClass: true },
  go: { function: ['function_declaration'], method: ['method_declaration'], goTypes: true },
  rust: { class: ['struct_item', 'enum_item', 'trait_item'], function: ['function_item'], asMethodInClass: true, rustImpl: true },
  c_sharp: { class: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration'], method: ['method_declaration', 'constructor_declaration'], function: ['local_function_statement'] },
};

let ready = null; // Promise<{ Parser, Language, langs: Map }> | false
const languages = new Map();

function modulePaths() {
  return { wasmDir: path.join(__dirname, '..', '..', 'vendor', 'tree-sitter-wasms') };
}

async function init() {
  if (ready !== null) return ready;
  ready = (async () => {
    try {
      const mod = require('web-tree-sitter');
      await mod.Parser.init();
      return { Parser: mod.Parser, Language: mod.Language };
    } catch { return false; }
  })();
  return ready;
}

async function languageFor(rt, name) {
  if (!languages.has(name)) {
    languages.set(name, (async () => {
      try {
        const file = path.join(modulePaths().wasmDir, `tree-sitter-${name}.wasm`);
        if (!fs.existsSync(file)) return null;
        return await rt.Language.load(file);
      } catch { return null; }
    })());
  }
  return languages.get(name);
}

const supported = (rel) => EXT[path.extname(String(rel)).toLowerCase()] || null;

/** The identifier of a declaration: its `name` field, else the first identifier-like child (some grammars have no fields). */
function nameNode(node) {
  const f = node.childForFieldName && node.childForFieldName('name');
  if (f) return f;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (/^(identifier|type_identifier|simple_identifier|property_identifier|field_identifier)$/.test(c.type)) return c;
  }
  return null;
}

function collect(root, lang) {
  const rules = RULES[lang];
  const out = [];
  const push = (nameN, kind, node) => { if (nameN && nameN.text) out.push({ name: nameN.text, kind, line: nameN.startPosition.row + 1, endLine: Math.max(nameN.startPosition.row + 1, node.endPosition.row + 1) }); };
  const walk = (node, inClass) => {
    let nextInClass = inClass;
    const t = node.type;
    if (rules.class && rules.class.includes(t)) { push(nameNode(node), 'class', node); nextInClass = true; }
    else if (rules.rustImpl && t === 'impl_item') { nextInClass = true; }
    else if (rules.method && rules.method.includes(t)) push(nameNode(node), 'method', node);
    else if (rules.function && rules.function.includes(t)) push(nameNode(node), rules.asMethodInClass && inClass ? 'method' : 'function', node);
    else if (rules.goTypes && t === 'type_spec') {
      const ty = node.childForFieldName('type');
      if (ty && /^(struct_type|interface_type)$/.test(ty.type)) push(node.childForFieldName('name'), 'class', node);
    } else if (rules.arrowVars && t === 'variable_declarator') {
      const v = node.childForFieldName('value');
      if (v && FUNCTION_VALUE.has(v.type)) push(node.childForFieldName('name'), 'function', node);
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), nextInClass);
  };
  walk(root, false);
  return out.sort((a, b) => a.line - b.line);
}

/** @returns {Promise<Array<{name, kind, line, endLine}>|null>} null = not supported / parser unavailable: use the line patterns */
async function symbols(rel, content) {
  const lang = supported(rel);
  const text = String(content == null ? '' : content);
  if (!lang || Buffer.byteLength(text) > MAX_BYTES) return null;
  const rt = await init();
  if (!rt) return null;
  const language = await languageFor(rt, lang);
  if (!language) return null;
  const parser = new rt.Parser();
  let tree = null;
  try {
    parser.setLanguage(language);
    tree = parser.parse(text);
    if (!tree) return null;
    return collect(tree.rootNode, lang);
  } catch { return null; } finally {
    try { if (tree) tree.delete(); parser.delete(); } catch { /* already freed */ }
  }
}

module.exports = { symbols, supported, EXT };
