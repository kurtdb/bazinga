'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ollama = require('../src/core/ollama');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const grab = (n) => src.match(new RegExp(`  (?:async )?function ${n}\\([\\s\\S]*?\\n  }\\n`))[0];
const line = (n) => src.match(new RegExp(`  const ${n} = .*\\n`))[0];
const helpers = new Function(`${line('DEFAULT_OLLAMA_URL')}${grab('modelOf')}${grab('agentLabel')}${grab('isModelServerUrl')}${grab('normalizeServerUrl')}${grab('isRemoteUrl')}${grab('isLocalAgent')}${line('LOCAL_HINT')}${line('localClaudeCmd')}return { modelOf, agentLabel, isLocalAgent, isModelServerUrl, normalizeServerUrl, isRemoteUrl, LOCAL_HINT, localClaudeCmd };`)();

test('local Claude preset: only the six file/shell tools, and the tool-rules hint is a standing instruction (a file, so no shell quoting)', () => {
  assert.equal(helpers.localClaudeCmd('qwen3:14b'), 'claude --model qwen3:14b --tools Read,Write,Edit,Bash,Glob,Grep');
  assert.match(helpers.LOCAL_HINT, /file_path/);
  assert.match(helpers.LOCAL_HINT, /required arguments/);
  for (const t of ['Read needs file_path', 'Write needs file_path and content', 'Edit needs file_path, old_string and new_string']) assert.ok(helpers.LOCAL_HINT.includes(t), t);
  assert.match(src, /name: 'qwen3:8b', command: localClaudeCmd\('qwen3:8b'\), hint: LOCAL_HINT/);
  assert.match(src, /command: localClaudeCmd\(m\), hint: LOCAL_HINT/, 'models listed from Ollama get the same setup');
});

test('regression: the task is never placed after --tools (a list option swallows it, and the terminal opened with no prompt)', () => {
  const { taskCommandFor } = new Function(`${grab('taskFirst')}${grab('taskCommandFor')}return { taskCommandFor };`)();
  const local = { command: `claude --append-system-prompt-file "C:\\a b\\hint.md" --model qwen3:14b --tools Read,Write,Edit,Bash,Glob,Grep` };
  const cmd = taskCommandFor(local);
  assert.equal(cmd, `claude {task} --append-system-prompt-file "C:\\a b\\hint.md" --model qwen3:14b --tools Read,Write,Edit,Bash,Glob,Grep`);
  assert.equal(taskCommandFor({ command: 'claude', taskCommand: 'claude {task}' }), 'claude {task}');
  assert.equal(taskCommandFor({ command: 'claude --tools Read', taskCommand: 'claude --tools Read {task}' }), 'claude {task} --tools Read');
  assert.equal(taskCommandFor({ command: 'copilot', taskCommand: 'copilot -i {task}' }), 'copilot -i {task}', 'other agents are left alone');
  assert.equal(taskCommandFor({ command: 'aider' }), null);
  // a parser like Claude Code's: --tools takes every following word up to the next option
  const parse = (words) => { const o = { pos: [] }; for (let i = 0; i < words.length; i++) { if (words[i] === '--tools') { o.tools = []; while (words[i + 1] && !words[i + 1].startsWith('-')) o.tools.push(words[++i]); } else if (words[i].startsWith('--')) { o.flags = (o.flags || []).concat(words[i]); i++; } else o.pos.push(words[i]); } return o; };
  assert.deepEqual(parse(['--model', 'm', '--tools', 'Read,Write', 'TASK']).pos, [], 'the old order loses the task');
  const words = cmd.replace('{task}', 'TASK').replace(/"[^"]*"/g, 'F').split(' ').slice(1);
  assert.deepEqual(parse(words).pos, ['TASK'], 'the new order delivers it');
});

test('regression: a template placeholder that was not filled in is not sent to the agent', () => {
  const { unfilledPlaceholder } = new Function(`${grab('unfilledPlaceholder')}return { unfilledPlaceholder };`)();
  const tpls = require('../src/core/tasktemplates').mergeTemplates({});
  const raw = tpls.find((t) => t.name === 'Write missing tests').text;
  assert.deepEqual(unfilledPlaceholder(raw, tpls), { text: '<class or area>', index: raw.indexOf('<class or area>') });
  assert.equal(unfilledPlaceholder(raw.replace('<class or area>', 'src/core/toolproxy.js'), tpls), null);
  assert.equal(unfilledPlaceholder('Compare a <b> tag handling', tpls), null, 'only placeholders of the templates count');
  assert.match(src, /const open = unfilledPlaceholder\(text, templates\);/);
});

test('workflow steps: per-step agent/model choice, else the workflow file, else the default, else the one used last', () => {
  let last = '';
  const { pickWorkflowAgent } = new Function('lastAgentName', `${grab('pickWorkflowAgent')}return { pickWorkflowAgent };`)(() => last);
  const agents = [{ name: 'Claude' }, { name: 'qwen3:14b' }, { name: 'qwen2.5-coder:14b' }];
  const pick = (step, st) => pickWorkflowAgent(step, st, agents);
  assert.equal(pick({ id: 's' }, {}).agent.name, 'Claude', 'nothing chosen: the first agent');
  last = 'qwen3:14b';
  assert.equal(pick({ id: 's' }, {}).agent.name, 'qwen3:14b', 'the one used last');
  assert.equal(pick({ id: 's' }, { agents: { default: 'qwen2.5-coder:14b' } }).agent.name, 'qwen2.5-coder:14b', 'the default chosen when starting');
  assert.equal(pick({ id: 's', agent: 'Claude' }, { agents: { default: 'qwen2.5-coder:14b' } }).agent.name, 'Claude', 'a step in the file keeps its agent');
  const st = { agents: { default: 'qwen3:14b', steps: { s: 'qwen2.5-coder:14b' } } };
  assert.equal(pick({ id: 's', agent: 'Claude' }, st).agent.name, 'qwen2.5-coder:14b', 'chosen for the step when starting wins');
  assert.equal(pick({ id: 't' }, st).agent.name, 'qwen3:14b', 'other steps use the default');
  const gone = pick({ id: 's', agent: 'Removed' }, st);
  assert.equal(gone.missing, 'Removed');
  assert.equal(gone.agent.name, 'qwen2.5-coder:14b');
  assert.equal(pick({ id: 's', agent: 'Removed' }, { agents: { default: 'zzz' } }).agent.name, 'qwen3:14b', 'an unknown default falls through to the last used');
  assert.equal(pickWorkflowAgent({ id: 's' }, {}, []).agent, null);
  assert.match(src, /wfStartNew\(\{ name: w\.name, source: w\.source, workflow: w\.workflow \}, input\.value, \{ default: defaultAgent\.value/);
});

test('regression: a workflow that uses {input} does not start with an empty input ("Refactor: . Behaviour must not change.")', () => {
  const { workflowNeedsInput } = new Function(`${grab('workflowNeedsInput')}return { workflowNeedsInput };`)();
  const wf = require('../src/core/workflow').parse(require('../src/core/workflow').BUILTIN[1], 'b').workflow;
  assert.equal(workflowNeedsInput(wf, ''), true);
  assert.equal(workflowNeedsInput(wf, '   \n'), true);
  assert.equal(workflowNeedsInput(wf, 'split OrderService'), false);
  assert.equal(workflowNeedsInput({ steps: [{ task: 'Run the tests' }] }, ''), false, 'no {input} in any step: nothing to ask for');
  assert.equal(workflowNeedsInput(null, ''), false);
  assert.match(src, /if \(workflowNeedsInput\(w\.workflow, input\.value\)\)/);
});

test('workflow fallback: a running step whose terminal has been silent for a long time counts as finished', () => {
  const { wfStalled } = new Function(`${line('wfStalled')}return { wfStalled };`)();
  const now = 1_000_000;
  assert.equal(wfStalled({ lastData: now - 95000 }, now), true);
  assert.equal(wfStalled({ lastData: now - 20000 }, now), false, 'a model that is still printing');
  assert.equal(wfStalled({ lastData: 0 }, now), false, 'no output seen yet: nothing to judge');
  assert.equal(wfStalled({ lastData: now - 95000, prompt: { text: 'Allow?' } }, now), false, 'a real question waits for you');
  assert.equal(wfStalled({ lastData: now - 95000, exited: true }, now), false);
  assert.equal(wfStalled(null, now), false);
});

test('local-model buttons are labelled with their model, and the generic add button is gone', () => {
  assert.doesNotMatch(src, /text: '\+ Local model \(Ollama\)'/);
  const { modelOf, agentLabel } = helpers;
  assert.equal(modelOf('claude --model qwen3:8b --disallowedTools WebSearch'), 'qwen3:8b');
  assert.equal(modelOf('aider --model ollama_chat/qwen3:8b'), 'qwen3:8b');
  assert.equal(modelOf('claude'), '');
  assert.equal(agentLabel({ name: 'Claude (local)', command: 'claude --model qwen3:14b' }), 'qwen3:14b', 'old generic buttons show the model');
  assert.equal(agentLabel({ name: 'Claude', command: 'claude' }), 'Claude');
  assert.equal(agentLabel({ name: 'My agent', command: 'claude --model x' }), 'My agent', 'custom names are kept');
});

test('the renderer and the main process agree on what a local agent is', () => {
  const cases = [
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'http://localhost:11434' } },
    { command: 'aider --model ollama_chat/x', env: { OLLAMA_API_BASE: 'http://127.0.0.1:11434' } },
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } },
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'http://192.168.1.20:11434' } },
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'http://gpu-box:8080' } },
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://litellm.corp.example.com' } },
    { command: 'claude', env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } },
    { command: 'claude' },
  ];
  for (const a of cases) assert.equal(helpers.isLocalAgent(a), !!ollama.localTarget(a), JSON.stringify(a));
});

test('agents are prepared (hint file, local-model check) before they start, from the button and from runs', () => {
  assert.match(src, /const prep = await prepareAgent\(a\);\s*\n\s*if \(!prep\) return;/);
  assert.match(src, /prep = await prepareAgent\(agent, false, unattended\);\s*\n\s*if \(!prep\)/);
  assert.match(src, /api\.agent\.prepare\(agent, \{ noHooks, inUse:/);
});

test('a missing model offers a download (ollama pull in a terminal, wait until listed) instead of "start anyway"', () => {
  const m = src.match(/const SAFE_MODEL = (\/.*\/);/);
  assert.ok(m, 'model names are validated before they are typed into a shell');
  const safe = new Function(`return ${m[1]}`)();
  for (const ok of ['qwen3:8b', 'qwen2.5-coder:14b', 'library/llama3.2', 'hf.co/user/model:Q4_K_M']) assert.ok(safe.test(ok), ok);
  for (const bad of ['x; rm -rf ~', 'a b', '$(id)', '`id`', 'a|b', '-rf', '']) assert.ok(!safe.test(bad), bad);
  assert.match(src, /initialInput: `ollama pull \$\{local\.model\}\\r`/);
  assert.match(src, /missing-model/);
  assert.match(src, /return prepareAgent\(agent, true, noHooks\)/, 'after the download it prepares again, once');
});

test('terminals started with claude remember that @file works', () => {
  const m = src.match(/entry\.atMention = (\/.*\/i)\.test/);
  assert.ok(m);
  const re = new Function(`return ${m[1]}`)();
  for (const ok of ['claude --model qwen3:8b\r', 'claude\r', 'C:\\tools\\claude.exe --x', '/usr/bin/claude']) assert.ok(re.test(ok), ok);
  for (const no of ['copilot', 'aider --model x', 'claudette', 'echo claude', '']) assert.ok(!re.test(no), no);
});

test('the Ollama server box accepts what people type, in the renderer exactly as in the main process', () => {
  const cases = ['', 'gpu-box', '192.168.1.20', '192.168.1.20:11434', 'http://192.168.1.20:11434/', 'https://ollama.example.com', 'localhost:11434', 'http://gpu-box:8080'];
  for (const c of cases) assert.equal(helpers.normalizeServerUrl(c), ollama.normalizeBaseUrl(c), JSON.stringify(c));
  assert.equal(helpers.normalizeServerUrl('gpu-box'), 'http://gpu-box:11434');
  assert.equal(helpers.normalizeServerUrl(''), 'http://localhost:11434');
  assert.equal(helpers.isRemoteUrl('http://gpu-box:11434'), true);
  assert.equal(helpers.isRemoteUrl('http://localhost:11434'), false);
  assert.equal(helpers.isRemoteUrl('http://127.0.0.1:11434'), false);
});

test('presets follow the chosen server, the server is saved, and a remote server gets no download offer', () => {
  assert.match(src, /a\.env\.ANTHROPIC_BASE_URL = url/);
  assert.match(src, /a\.env\.OLLAMA_API_BASE = url/);
  assert.match(src, /env: localEnv\(serverUrl\(\)\)/);
  assert.match(src, /next\.ollama = \{ baseUrl: serverUrl\(\)/);
  assert.match(src, /missing && !retried && !r\.local\.remote/);
});

test('the local-model settings reach the terminal, and the agent\'s own env wins over them', () => {
  assert.match(src, /\{ \.\.\.\(prep\.env \|\| \{\}\), \.\.\.\(a\.env \|\| \{\}\), \.\.\.\(prep\.envForce \|\| \{\}\) \}/, 'button: the helper address wins last');
  assert.match(src, /inlineAgentEnv = \{ \.\.\.prep\.env, \.\.\.\(agent\.env \|\| \{\}\), \.\.\.\(prep\.envForce \|\| \{\}\) \}/, 'runs');
  assert.match(src, /unloadOthers: unloadOn\.checked/);
});

test('the model self-test is reachable from the agent row (local Claude agents only) and from the main process', () => {
  assert.match(src, /title: 'Check that this model can be sent a file/);
  assert.match(src, /api\.agent\.test\(a\)/);
  assert.match(src, /api\.agent\.onTestProgress\(onProgress\)/, 'live progress');
  assert.match(src, /if \(modelTestPanel && modelTestPanel\.root\.isConnected\) return modelTestPanel/, 'one test at a time');
  assert.match(src, /api\.agent\.testCancel\(\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('agent:test'/);
  assert.match(main, /ipcMain\.handle\('agent:testCancel'/);
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  assert.match(pre, /test: \(agent\) => invoke\('agent:test', agent\)/);
});
