'use strict';
/**
 * Self-check of the workflow machinery on THIS machine with THIS agent: a throw-away two-step workflow (write a file, then read it).
 * It answers in half a minute what a whole evening of trying would: does the "agent finished" signal arrive, is the gate checked,
 * does step 2 start by itself? The workflow definition and the reading of the result live here, so they can be tested without the UI.
 */
const FILE = 'bazinga-selfcheck.txt';

const WORKFLOW = {
  name: 'Bazinga self-check',
  description: 'Throw-away check of the workflow machinery: step 1 writes a file, step 2 reads it.',
  mode: 'interactive',
  finish: 'none',
  steps: [
    { id: 'write', agent: '', gate: 'changed', needs: [], approval: 'none', retries: 0, timeout: 10, allow: '', task: `Create a file named ${FILE} in the current folder that contains exactly the word ok. Do nothing else.` },
    { id: 'read', agent: '', gate: 'none', needs: ['write'], approval: 'none', retries: 0, timeout: 10, allow: '', task: `Read the file ${FILE} and tell me what it contains. Do not change any files.` },
  ],
};

const SIGNAL_TEXT = { hook: 'Claude Code said it finished (hook)', quiet: 'guessed from a quiet terminal', exit: 'the process ended', forced: 'the Done button or the stall fallback' };

/**
 * @param {object} st  the workflow state (steps: { id: { status, runId, why, signal, attempts } }, finished)
 * @returns {{ done: boolean, ok: boolean, items: Array<{id,label,state,detail}>, advice: string[] }}
 */
function verdict(st) {
  const s = (id) => (st && st.steps && st.steps[id]) || {};
  const a = s('write'); const b = s('read');
  const items = []; const advice = [];
  const add = (id, label, state, detail = '') => items.push({ id, label, state, detail });

  add('start', 'Step 1 started the agent', a.runId ? 'ok' : 'wait', a.runId ? '' : 'waiting for the agent to start');

  const signalled = !!a.signal || ['passed', 'failed', 'awaiting-gate'].includes(a.status);
  if (!a.runId) add('signal', 'Bazinga was told that step 1 finished', 'wait');
  else if (!signalled) add('signal', 'Bazinga was told that step 1 finished', 'wait', 'the agent is still working, or the signal did not arrive');
  else if (a.signal === 'hook' || a.signal === 'exit') add('signal', 'Bazinga was told that step 1 finished', 'ok', SIGNAL_TEXT[a.signal]);
  else {
    add('signal', 'Bazinga was told that step 1 finished', 'warn', SIGNAL_TEXT[a.signal] || 'unknown');
    advice.push('The “finished” signal was guessed from a quiet terminal, not reported by Claude Code. That works, but is fragile. Open the Debug tab and filter on Hooks: if nothing arrives there, check that Settings → “Claude Code reports when it is done (hooks)” is on and that your Claude Code version accepts hooks passed with --settings.');
  }

  if (a.status === 'failed') {
    add('gate', 'Step 1 passed its check (a file was created)', 'fail', a.why || '');
    if (/changed no files/.test(a.why || '')) advice.push('The agent answered but changed nothing: it did not use its Write tool. With a small local model, run “Test” on the agent (Settings) and look at the tool-call helper’s findings.');
    else if (/time limit|stopped after/.test(a.why || '')) advice.push('The agent was still busy after 10 minutes. The model is probably too slow or looping; check the Debug tab’s Model lines.');
    else if (/exit code/.test(a.why || '')) advice.push('The agent process ended with an error. Open its terminal tab to read why.');
  } else if (['passed', 'awaiting-approval'].includes(a.status) || b.runId) add('gate', 'Step 1 passed its check (a file was created)', 'ok');
  else add('gate', 'Step 1 passed its check (a file was created)', 'wait');

  const bStarted = !!b.runId;
  add('chain', 'Step 2 started by itself', bStarted ? 'ok' : (a.status === 'failed' ? 'fail' : 'wait'), bStarted ? '' : (a.status === 'failed' ? 'not reached' : ''));
  if (a.status === 'passed' && !bStarted) advice.push('Step 1 passed but step 2 did not start. Look at the Debug tab, filter Workflow: the line after “passed, starting what comes next” shows why.');

  const finished = !!(st && st.finished);
  const bSig = !!b.signal || ['passed', 'failed'].includes(b.status);
  add('finish', 'Step 2 finished and the workflow completed', finished ? 'ok' : (b.status === 'failed' ? 'fail' : bStarted && bSig ? 'wait' : 'wait'), b.status === 'failed' ? (b.why || '') : '');

  const done = finished || a.status === 'failed' || b.status === 'failed';
  const ok = finished && items.every((i) => i.state === 'ok' || i.state === 'warn');
  if (ok && !advice.length) advice.push('Everything worked: the workflow machinery is fine with this agent.');
  return { done, ok, items, advice };
}

module.exports = { WORKFLOW, FILE, verdict, SIGNAL_TEXT };
