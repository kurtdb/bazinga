'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePayload, capabilityReply, Osc7501Tracker } = require('../src/core/osc7501');

const ESC = '\x1b';
const ST = `${ESC}\\`;
const seq = (payload) => `${ESC}]7501;${payload}${ST}`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('parsePayload: a bare "?" is a feature query', () => {
  assert.deepEqual(parsePayload('?'), { query: true });
  assert.deepEqual(parsePayload(' ? '), { query: true });
});

test('parsePayload: state is required; missing or unknown discards the whole report', () => {
  assert.equal(parsePayload('id=build'), null);
  assert.equal(parsePayload('state=sleeping'), null);
  assert.deepEqual(parsePayload('state=working'), { state: 'working' });
});

test('parsePayload: malformed pairs are skipped, not fatal; a repeated key keeps the last value', () => {
  assert.deepEqual(parsePayload('bogus:state=done'), { state: 'done' });
  assert.deepEqual(parsePayload('=novalue:state=done'), { state: 'done' });
  assert.deepEqual(parsePayload('state=working:state=done'), { state: 'done' });
});

test('parsePayload: id grammar - segments, length and depth', () => {
  assert.deepEqual(parsePayload('state=working:id=build/test'), { state: 'working', id: 'build/test' });
  assert.equal(parsePayload(`state=working:id=${'a'.repeat(33)}`), null, 'a segment over 32 chars is invalid');
  assert.equal(parsePayload(`state=working:id=${Array(9).fill('a').join('/')}`), null, 'over 8 levels deep is invalid');
  assert.equal(parsePayload('state=working:id=foo,bar'), null, 'a comma passes the generic value grammar but not the stricter id-segment grammar');
});

test('parsePayload: kind only means something with blocked; unrecognized kind is dropped, not rejected', () => {
  assert.deepEqual(parsePayload('state=blocked:kind=permission'), { state: 'blocked', kind: 'permission' });
  assert.deepEqual(parsePayload('state=blocked:kind=nonsense'), { state: 'blocked' });
});

test('parsePayload: progress is an integer 0-100, otherwise absent', () => {
  assert.deepEqual(parsePayload('state=working:progress=42'), { state: 'working', progress: 42 });
  assert.deepEqual(parsePayload('state=working:progress=101'), { state: 'working' });
  assert.deepEqual(parsePayload('state=working:progress=abc'), { state: 'working' });
});

test('parsePayload: title/msg are base64 UTF-8, size-capped, and reject embedded control characters', () => {
  assert.deepEqual(parsePayload(`state=blocked:msg=${b64('needs your approval')}`), { state: 'blocked', msg: 'needs your approval' });
  assert.equal(parsePayload(`state=blocked:msg=${b64('line one\nline two')}`), null, 'a decoded control character discards the whole report');
  assert.equal(parsePayload(`state=blocked:title=${b64('x'.repeat(300))}`), null, 'over the 192-byte decoded cap for title');
});

test('Osc7501Tracker.feed: a root report and an id-addressed report are kept apart, each fully replacing its own record', () => {
  const t = new Osc7501Tracker();
  const [a] = t.feed(seq('state=working'));
  assert.deepEqual(a, { id: undefined, record: { state: 'working' } });
  const [b] = t.feed(seq('state=blocked:id=build:kind=permission'));
  assert.deepEqual(b, { id: 'build', record: { state: 'blocked', kind: 'permission' } });
  const [c] = t.feed(seq('state=done')); // replaces the root entirely - no lingering keys from the first report
  assert.deepEqual(c, { id: undefined, record: { state: 'done' } });
  assert.equal(t.records.get('build').state, 'blocked', 'the id-addressed record is untouched by a root report');
});

test('Osc7501Tracker.feed: clear removes a record and its descendants; clear with no id wipes everything', () => {
  const t = new Osc7501Tracker();
  t.feed(seq('state=working:id=build'));
  t.feed(seq('state=working:id=build/test'));
  t.feed(seq('state=working:id=deploy'));
  const [ev] = t.feed(seq('state=clear:id=build'));
  assert.deepEqual(ev, { id: 'build', cleared: true });
  assert.ok(!t.records.has('build') && !t.records.has('build/test') && t.records.has('deploy'));
  t.feed(seq('state=clear'));
  assert.equal(t.records.size, 0);
});

test('Osc7501Tracker.feed: two sequences in the same chunk are both found, and surrounding bytes are ignored', () => {
  const t = new Osc7501Tracker();
  const evs = t.feed(`hello ${seq('state=working')} world ${seq('state=done')} bye`);
  assert.equal(evs.length, 2);
  assert.equal(evs[1].record.state, 'done');
});

test('Osc7501Tracker.feed: BEL is also a valid terminator', () => {
  const t = new Osc7501Tracker();
  const [ev] = t.feed(`${ESC}]7501;state=working\x07`);
  assert.deepEqual(ev, { id: undefined, record: { state: 'working' } });
});

test('Osc7501Tracker.feed: an oversized sequence is discarded outright', () => {
  const t = new Osc7501Tracker();
  const huge = seq(`state=working:junk=${'a'.repeat(5000)}`); // an unknown key is ignored for semantics, but still counts toward the whole-sequence cap
  assert.ok(huge.length > 4096);
  assert.deepEqual(t.feed(huge), []);
});

test('capabilityReply: advertises the default states/kinds, OSC-terminated', () => {
  const reply = capabilityReply();
  assert.ok(reply.startsWith(`${ESC}]7501;?:states=`) && reply.endsWith(ST));
  assert.match(reply, /kinds=permission,question,auth/);
});
