'use strict';
/**
 * "Open in VS Code / IntelliJ": build the command that opens a file at a line in another editor.
 * Pure (the caller says which programs exist), so every platform's case is tested without the programs.
 */
const path = require('node:path');

const EDITORS = {
  vscode: { label: 'VS Code', bins: ['code'], mac: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'], macApp: 'Visual Studio Code' },
  idea: { label: 'IntelliJ IDEA', bins: ['idea', 'idea64', 'idea.sh'], mac: ['/Applications/IntelliJ IDEA.app/Contents/MacOS/idea', '/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea'], macApp: 'IntelliJ IDEA' },
};

/** Which editor suits the project when the user did not say: Java builds -> IntelliJ, everything else -> VS Code. */
function pick(setting, { hasJavaBuild, available }) {
  if (setting === 'vscode' || setting === 'idea') return setting;
  const order = hasJavaBuild ? ['idea', 'vscode'] : ['vscode', 'idea'];
  return order.find((id) => available.includes(id)) || order[0];
}

/**
 * @param id 'vscode' | 'idea'
 * @param found {bin?: string}  the executable the caller found (first of bins on PATH, or a known macOS path)
 * @returns {{bin:string,args:string[]}|{error:string}}
 */
function command(id, found, { root, rel, line = 1, column = 1 }) {
  const e = EDITORS[id];
  if (!e) return { error: 'Unknown editor.' };
  if (!found || !found.bin) return { error: `${e.label} was not found. ${id === 'vscode' ? 'In VS Code: Command Palette → “Shell Command: Install ‘code’ command in PATH”.' : 'In IntelliJ: Tools → Create Command-line Launcher.'}` };
  const file = path.join(root, rel);
  const ln = Math.max(1, Number(line) || 1); const col = Math.max(1, Number(column) || 1);
  if (id === 'vscode') return { bin: found.bin, args: ['--reuse-window', '-g', `${file}:${ln}:${col}`] };
  return { bin: found.bin, args: [root, '--line', String(ln), '--column', String(col), file] };
}

module.exports = { EDITORS, pick, command };
