'use strict';
/**
 * Unattended steps: Claude Code in print mode (`claude -p`) does the task, prints its answer and exits. The process ending is a certain
 * "done" signal, with no guessing from a quiet terminal and no permission questions nobody could answer. The cost: no live view of the
 * work, and only what the agent button already allows runs without asking (file edits are accepted, shell commands are not unless allowed).
 */
const EXIT = { posix: '; exit $?', ps: '; exit $LASTEXITCODE', cmd: ' & exit %errorlevel%' };

const isClaude = (cmd) => /^\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?(?:\s|$)/i.test(String(cmd || ''));

/**
 * @param {string} cmd   the command as it will be typed, the task already in it (`claude "$BAZINGA_TASK" --tools ...`)
 * @param {'posix'|'ps'|'cmd'} shell
 * @returns {string|null} null = not a Claude Code command (print mode does not apply)
 */
function printCommand(cmd, shell = 'posix') {
  const c = String(cmd || '').trim();
  if (!isClaude(c)) return null;
  let out = c.replace(/^(\s*(?:[^\s]*[\\/])?claude(?:\.exe|\.cmd)?)(?=\s|$)/i, '$1 -p');
  if (!/(^|\s)(--permission-mode|--dangerously-skip-permissions|--allow-dangerously-skip-permissions)(\s|=|$)/.test(out)) out += ' --permission-mode acceptEdits';
  return out + (EXIT[shell] || EXIT.posix);
}

module.exports = { printCommand, isClaude, EXIT };
