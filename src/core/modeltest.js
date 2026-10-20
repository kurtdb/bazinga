'use strict';
// A self-test for an agent on a local model: can it be sent a file, can it read one with its tool, can it write one to disk?
// It runs the agent's own command non-interactively (claude -p) in a throw-away folder and checks the result on disk, so a
// model that only *talks* about writing a file is caught.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PROMPT_ATTACH = 'What is the secret word in @input.txt? Reply with only that word.';
const PROMPT_WRITE = 'Use the Read tool to read input.txt in the current directory. Then use the Write tool to create output.txt in the current directory, containing only the secret word from input.txt and nothing else.';
const TAIL = 1800;

/**
 * Claude Code's stream-json output -> what the model really did: its tool calls, what each returned, and its final words.
 * Lines that are not JSON (warnings, plain output of older versions) are kept as notes.
 */
function parseStream(output) {
  const calls = []; const results = new Map(); const notes = []; let final = '';
  for (const raw of String(output || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let ev = null;
    if (line.startsWith('{')) { try { ev = JSON.parse(line); } catch { ev = null; } }
    if (!ev || typeof ev !== 'object') { notes.push(line); continue; }
    const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    if (ev.type === 'assistant') for (const c of content) if (c && c.type === 'tool_use') calls.push({ id: c.id, name: c.name, input: c.input || {} });
    if (ev.type === 'user') for (const c of content) if (c && c.type === 'tool_result') results.set(c.tool_use_id, { isError: !!c.is_error, text: textOf(c.content) });
    if (ev.type === 'result' && typeof ev.result === 'string') final = ev.result;
  }
  return { calls: calls.map((c) => ({ ...c, result: results.get(c.id) || null })), final, notes, structured: calls.length > 0 || final !== '' };
}
/** The text a person would see: the model's words, warnings, tool results. Never the raw JSON events themselves. */
const plainOf = (parsed, raw) => (parsed.structured || parsed.notes.length ? [parsed.final, ...parsed.notes, ...parsed.calls.map((c) => c.result && c.result.text)].filter(Boolean).join('\n') : String(raw || ''));
function textOf(c) { return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('') : ''; }
const short = (t, n = 160) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

/** When the time ran out: what the model was doing (from the partial messages). */
const span = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} minutes` : `${Math.max(1, Math.round(ms / 1000))} seconds`);
function stalledDetail(act, ms) {
  if (!act || !act.kind) return `The model produced nothing in ${span(ms)}.`;
  const k = act.kind;
  const doing = { thinking: 'still thinking', text: 'still writing its reply', tool: 'still building a tool call' }[k];
  const tail = String(act.tail[k] || '').replace(/\s+/g, ' ').trim();
  return `After ${span(ms)} the model was ${doing} (${act.chars[k].toLocaleString('en')} characters).${tail ? ` Last words: “…${tail.slice(-160)}”` : ''}`;
}
function stalledAdvice(act) {
  if (!act || !act.kind) return [];
  if (act.kind === 'thinking') return ['The model got stuck “thinking”. qwen3 models think at length before every answer, and on a laptop that can take minutes or never end. Bazinga adds /no_think to the standing instructions for qwen3 models (Settings → Agents, “Turn off qwen3 thinking”); make sure that is on, or use a model without a thinking mode.'];
  if (act.kind === 'tool') return ['The model got stuck while building its tool call (it kept generating the arguments). Models of this size sometimes loop there; a larger model or Aider usually avoids it.'];
  return ['The model kept writing text and never finished. It may be looping; a larger model usually avoids it.'];
}

/** What the proxy saw that explains a failure. */
function wireAdvice(records) {
  const out = [];
  for (const r of records || []) {
    if (r.error && !/closed the connection/.test(r.error)) out.push(`The model server returned an error: ${short(r.error, 200)}`);
    const sm = r.summary;
    if (!sm) continue;
    if (sm.held) out.push('The model wrote something that looks like a tool call, but Bazinga could not read it as one (usually broken JSON, or a reply that was cut off). The text is under “Behind the scenes”.');
    for (const b of sm.blocks) if (b.type === 'tool_use' && b.missing && b.missing.length) out.push(`The model called ${b.name} without ${b.missing.join(', ')}; Claude Code rejects a call like that.`);
  }
  return out;
}
const repaired = (detail, fixes) => (fixes && fixes.length ? `${detail} Bazinga had to repair its tool call.` : detail);

/** One line per tool call: the call, and what it returned. */
function traceLines(parsed) {
  return parsed.calls.map((c) => {
    const target = c.input.file_path || c.input.path || c.input.command || c.input.pattern || '';
    const res = c.result ? (c.result.isError ? `FAILED: ${short(c.result.text)}` : 'ok') : 'no result';
    return `${c.name}(${short(target, 90)}) → ${res}`;
  });
}

/** What the output tells us about why a step failed. */
function diagnose(text, { wroteNothing = false } = {}) {  const t = String(text || '');
  const out = [];
  if (/Invalid tool parameters|InputValidationError|missing required|required parameter/i.test(t)) out.push('The model called a tool with wrong or missing arguments (invalid parameters).');
  if (wroteNothing && /"(file_path|path|content|arguments|name)"\s*:/.test(t)) out.push('The model wrote the tool call as plain text instead of making it, so nothing ran. This is a model limitation with tool calls; a different model (for example qwen3:14b) or Aider usually works.');
  if (/Context limit reached|context (window )?(is )?full/i.test(t)) out.push('Claude Code thinks the context window is full. It reserves room for the model\'s reply out of the window (Settings → Agents → “Longest reply”); on a 32k window a big reserve leaves almost nothing. Lower it, or give Ollama a larger context (OLLAMA_CONTEXT_LENGTH).');
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|Unable to connect/i.test(t)) out.push('Claude Code could not reach the model server. Is Ollama running, and is the address right?');
  if (/model .*not found|"not found"|404/i.test(t) && /model/i.test(t)) out.push('The server does not know this model name. Check it with “ollama list”.');
  if (/context|truncat/i.test(t) && /exceed|too (long|large)|overflow/i.test(t)) out.push('The conversation did not fit in the model\'s context window.');
  return out;
}

/** Follows the partial-message events of a running model: is it thinking, writing text, or building a tool call, and how much so far. */
function createActivity() {
  const a = { kind: null, chars: { thinking: 0, text: 0, tool: 0 }, tail: { thinking: '', text: '', tool: '' } };
  const NAME = { thinking_delta: 'thinking', text_delta: 'text', input_json_delta: 'tool' };
  a.feed = (ev) => {
    const e = ev && ev.type === 'stream_event' ? ev.event : null;
    if (!e) return;
    if (e.type === 'content_block_start' && e.content_block) {
      const t = e.content_block.type;
      a.kind = t === 'thinking' ? 'thinking' : t === 'tool_use' ? 'tool' : 'text';
      if (t === 'tool_use') a.tail.tool = `${e.content_block.name || ''} `;
    }
    if (e.type === 'content_block_delta' && e.delta) {
      const k = NAME[e.delta.type];
      if (!k) return;
      const piece = e.delta.thinking || e.delta.text || e.delta.partial_json || '';
      a.kind = k; a.chars[k] += piece.length; a.tail[k] = (a.tail[k] + piece).slice(-300);
    }
  };
  a.summary = () => {
    if (!a.kind) return 'waiting for the model to start answering…';
    const n = a.chars[a.kind];
    const what = { thinking: 'thinking', text: 'writing its reply', tool: 'building a tool call' }[a.kind];
    return `${what}… (${n.toLocaleString('en')} characters so far)`;
  };
  return a;
}

/** Kill the shell AND what it started (claude): on POSIX the whole process group, on Windows the tree. */
function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

/** The proxy sees tool arguments as they are generated (Claude Code only gets them whole): fold that into the activity. */
function mergeLive(act, live) {
  if (!live || !live.kind || !act) return;
  const k = live.kind;
  if (!(k in act.chars)) return;
  if (live.chars >= act.chars[k]) { act.kind = k; act.chars[k] = live.chars; if (live.tail) act.tail[k] = live.tail; }
}

function runOnce({ command, prompt, cwd, env, timeoutMs, spawnImpl = spawn, onActivity = () => {}, getLive = null }) {
  let child = null;
  const started = Date.now();
  const promise = new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (extra) => { if (done) return; done = true; clearTimeout(timer); clearInterval(beat); if (getLive) mergeLive(act, getLive()); resolve({ output: out, activity: act, seconds: Math.round((Date.now() - started) / 100) / 10, ...extra }); };
    const act = createActivity();
    let lineBuf = '';
    const onData = (d) => {
      out += d;
      lineBuf += d;
      const lines = lineBuf.split('\n'); lineBuf = lines.pop();
      for (const l of lines) if (l.startsWith('{"type":"stream_event"')) { try { act.feed(JSON.parse(l)); } catch { /* partial line */ } }
    };
    const beat = setInterval(() => { if (getLive) mergeLive(act, getLive()); onActivity(act.summary()); }, 3000);
    const line = `${command} -p "${prompt}" --permission-mode acceptEdits --no-session-persistence --output-format stream-json --verbose --include-partial-messages`;
    try { child = spawnImpl(line, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' }); } catch (e) { finish({ error: e.message }); return; }
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => finish({ error: e.message }));
    child.on('close', (code) => finish({ code }));
    const timer = setTimeout(() => { killTree(child); finish({ timedOut: true }); }, timeoutMs);
  });
  return { promise, cancel: () => killTree(child) };
}

/** Starts the test. Returns { promise, cancel }; the promise resolves with { ok, steps, advice, output, seconds }. */
function start({ command, env, timeoutMs = 15 * 60 * 1000, spawnImpl, tmpBase = os.tmpdir(), onProgress = () => {}, proxy = null }) {
  let cancelled = false;
  let current = null;
  const promise = (async () => {
    const dir = fs.mkdtempSync(path.join(tmpBase, 'bazinga-modeltest-'));
    const token = `bz${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(path.join(dir, 'input.txt'), `The secret word is ${token}.\n`);
    const steps = [];
    const advice = [];
    const shown = [];
    const wire = []; const repairs = [];
    let seconds = 0;
    const getLive = proxy ? () => proxy.live() : null;
    // what went over the wire during one step, and what the proxy repaired
    const wireOf = (title, mark) => {
      if (!proxy) return { fixes: [], records: [] };
      const lines = proxy.lines(mark);
      if (lines.length) wire.push(`--- ${title} ---`, ...lines);
      const fixes = proxy.fixes(mark);
      repairs.push(...fixes);
      return { fixes, records: proxy.trace.since(mark) };
    };
    const log = (title, parsed, raw) => {
      shown.push(`--- ${title} ---`);
      if (parsed.calls.length) shown.push(...traceLines(parsed).map((l) => `  tool: ${l}`));
      if (parsed.final) shown.push(`  said: ${short(parsed.final, 600)}`);
      if (parsed.notes.length) shown.push(...parsed.notes.slice(-12).map((l) => `  ${short(l, 300)}`));
      if (!parsed.structured && !parsed.notes.length && raw) shown.push(`  ${short(raw, 600)}`);
    };
    try {
      // 1) the file is sent along with the prompt (@file): the model never needs a tool to see it
      onProgress({ id: 'attach', state: 'running' });
      const markA = proxy ? proxy.trace.mark() : 0;
      current = runOnce({ command, prompt: PROMPT_ATTACH, cwd: dir, env, timeoutMs, spawnImpl, getLive, onActivity: (t) => onProgress({ id: 'attach', state: 'running', detail: t }) });
      const a = await current.promise;
      const pa = parseStream(a.output);
      log('send a file (@input.txt)', pa, a.output);
      seconds += a.seconds;
      const sawIt = !a.timedOut && !a.error && (pa.final || a.output).includes(token);
      const wa = wireOf('send a file (@input.txt)', markA);
      steps.push({ id: 'attach', label: 'Sending a file with @file', ok: sawIt, detail: sawIt ? repaired(`Answered with the secret word (${a.seconds}s).`, wa.fixes) : a.timedOut ? stalledDetail(a.activity, timeoutMs) : a.error ? a.error : 'The answer did not contain the secret word from the file.' });
      if (!sawIt) advice.push(...wireAdvice(wa.records), ...diagnose(plainOf(pa, a.output)), ...(a.timedOut ? stalledAdvice(a.activity) : []));
      onProgress({ id: 'attach', state: 'done', ok: sawIt, detail: steps[0].detail });
      if (cancelled) return { ok: false, cancelled: true, steps, advice, output: shown.join('\n').slice(-TAIL), wire, repairs: [...new Set(repairs)], seconds };

      // 2) read with the tool, write with the tool: checked on disk, and the tool calls are shown
      onProgress({ id: 'write', state: 'running' });
      const markB = proxy ? proxy.trace.mark() : 0;
      current = runOnce({ command, prompt: PROMPT_WRITE, cwd: dir, env, timeoutMs, spawnImpl, getLive, onActivity: (t) => onProgress({ id: 'write', state: 'running', detail: t }) });
      const b = await current.promise;
      const pb = parseStream(b.output);
      log('read + write with tools', pb, b.output);
      seconds += b.seconds;
      const wb = wireOf('read + write with tools', markB);
      const file = path.join(dir, 'output.txt');
      const wrote = fs.existsSync(file);
      const content = wrote ? fs.readFileSync(file, 'utf8').trim() : '';
      const writeCalls = pb.calls.filter((c) => /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(c.name));
      const readCalls = pb.calls.filter((c) => c.name === 'Read');
      const readTool = readCalls.some((c) => c.result && !c.result.isError && c.result.text.includes(token));
      // the secret word is only in input.txt: seeing it anywhere in what the model did or said proves it read the file
      const readOk = readTool || (wrote && content.includes(token)) || (!!pb.final && pb.final.includes(token));
      let writeDetail;
      const contentOk = wrote && content.includes(token);
      if (wrote && !contentOk) writeDetail = `output.txt was created, but it holds “${short(content, 60)}” instead of the secret word.`;
      else if (wrote) writeDetail = repaired(`output.txt was created (${b.seconds}s).`, wb.fixes);
      else if (b.timedOut) writeDetail = `${readCalls.length || writeCalls.length ? `It called ${pb.calls.map((c) => c.name).join(', ')} and then stopped. ` : ''}${stalledDetail(b.activity, timeoutMs)}`;
      else if (writeCalls.length) {
        const c = writeCalls[0];
        const where = c.input.file_path || c.input.path || '?';
        writeDetail = c.result && c.result.isError ? `It called ${c.name}(${short(where, 80)}), and the tool failed: ${short(c.result.text)}` : `It called ${c.name}(${short(where, 80)}), but no output.txt appeared in the test folder: it wrote somewhere else (or into a folder that was not allowed).`;
        if (c.result && !c.result.isError && path.isAbsolute(String(where)) && !path.resolve(String(where)).startsWith(dir)) advice.push(`The model used the path ${where} instead of the current folder, so the file went elsewhere. Check that location, and the standing instructions: they tell the model to build absolute paths from the working directory.`);
      } else if (pb.structured) writeDetail = 'It never called a write tool. Its final message may claim it did.';
      else writeDetail = 'No file was created.';
      steps.push({ id: 'write', label: 'Writing a file to disk', ok: contentOk, detail: writeDetail });
      steps.push({ id: 'read', label: 'Reading a file with its tool', ok: readOk, detail: readOk ? (readTool ? 'It called Read and got the secret word.' : 'It knew the secret word from input.txt, which only reading the file can explain.') : wrote ? `It wrote a file, but not the word from input.txt (it wrote “${content.slice(0, 60)}”): it did not read the file correctly.` : readCalls.length ? 'It called Read, but did not get the secret word back.' : 'No sign that it read the file.' });
      if (b.timedOut) advice.push(...stalledAdvice(b.activity));
      if (!contentOk || !readOk) advice.push(...wireAdvice(wb.records));
      if (!contentOk) {
        advice.push(...diagnose(plainOf(pb, b.output), { wroteNothing: !writeCalls.length }));
        if (pb.structured && !writeCalls.length && /\b(written|wrote|created|saved)\b/i.test(pb.final)) advice.push('The model said it wrote the file but never called the Write tool: it claimed success without doing it. Models this size often do that; a larger model or Aider (which applies the edits itself) is the usual way out.');
      } else if (!readOk) advice.push(...diagnose(plainOf(pb, b.output)));
      for (const st of steps.slice(1)) onProgress({ id: st.id, state: 'done', ok: st.ok, detail: st.detail });
      return { ok: steps.every((st) => st.ok), steps, advice: [...new Set(advice)], output: shown.join('\n').slice(-TAIL), wire: wire.join('\n').length > 6000 ? [`…`, ...wire.join('\n').slice(-6000).split('\n')] : wire, repairs: [...new Set(repairs)], seconds: Math.round(seconds * 10) / 10 };
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
    }
  })();
  return { promise, cancel: () => { cancelled = true; if (current) current.cancel(); } };
}

module.exports = { start, diagnose, wireAdvice, mergeLive, parseStream, traceLines, createActivity, stalledDetail, PROMPT_ATTACH, PROMPT_WRITE };
