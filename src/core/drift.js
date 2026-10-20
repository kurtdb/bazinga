'use strict';
/**
 * Notices when Claude Code changes under Bazinga. Bazinga reads Claude Code's hook reports, telemetry and transcript; none of that is
 * a promise. So: the version is recorded (from `claude --version` and from the telemetry), you can confirm a version as checked,
 * and a notice appears when Claude Code is newer than the one you confirmed or when a hook report carries fields Bazinga does not
 * know. A notice means "look again", not "broken".
 */
const fs = require('node:fs');
const path = require('node:path');

// top-level fields of hook reports that Bazinga knows about (from Claude Code's hooks documentation)
const KNOWN_FIELDS = new Set([
  'session_id', 'transcript_path', 'cwd', 'hook_event_name', 'permission_mode', 'stop_hook_active', 'last_assistant_message', 'notification_type', 'message', 'title',
  'prompt', 'source', 'agent_id', 'agent_type', 'agent_transcript_path', 'tool_name', 'tool_input', 'tool_response', 'tool_use_id', 'model', 'reason', 'trigger', 'custom_instructions',
]);
const MAX_UNKNOWN = 30;

/** "2.1.3 (Claude Code)" -> "2.1.3"; anything without a version -> '' */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)(?:[-+][\w.]+)?/.exec(String(text || ''));
  return m ? m[0] : '';
}

/** -1, 0 or 1; compares major.minor.patch only (a pre-release tag is ignored). */
function compareVersions(a, b) {
  const pa = String(a).split(/[-+]/)[0].split('.').map(Number); const pb = String(b).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

class Drift {
  /** @param {{file: string, notify?: (text: string) => void}} o */
  constructor({ file, notify = () => {} }) {
    this.file = file; this.notify = notify;
    this.state = { version: '', tested: '', seen: [], unknown: [] };
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') this.state = { ...this.state, ...j, seen: Array.isArray(j.seen) ? j.seen : [], unknown: Array.isArray(j.unknown) ? j.unknown : [] }; } catch { /* first run */ }
    this.told = new Set(); // notices already shown in this session
  }

  _save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch { /* best effort */ } }
  _tell(key, text) { if (this.told.has(key)) return; this.told.add(key); try { this.notify(text); } catch { /* a notice never breaks anything */ } }

  /** A version was seen (from the command line or from telemetry). */
  noteVersion(raw) {
    const v = parseVersion(raw);
    if (!v) return false;
    const changed = this.state.version !== v;
    this.state.version = v;
    if (!this.state.seen.includes(v)) { this.state.seen.push(v); this.state.seen = this.state.seen.slice(-10); changed && this._save(); }
    else if (changed) this._save();
    if (this.state.tested && compareVersions(v, this.state.tested) > 0) {
      this._tell(`newer:${v}`, `Claude Code was updated to ${v} (you last confirmed ${this.state.tested}). If everything still works, open “Setup & health” and confirm the new version; if something looks off, that is the first place to look.`);
    }
    return true;
  }

  /** A hook report arrived. Unknown top-level fields are remembered (names only, never values). */
  noteHook(event, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const fresh = Object.keys(payload).filter((k) => k.length <= 60 && /^[\w.-]+$/.test(k) && !KNOWN_FIELDS.has(k) && !this.state.unknown.some((u) => u.field === k));
    if (!fresh.length) return [];
    for (const k of fresh) if (this.state.unknown.length < MAX_UNKNOWN) this.state.unknown.push({ field: k, event: String(event), version: this.state.version });
    this._save();
    this._tell(`fields:${fresh.join(',')}`, `This Claude Code version sends some information Bazinga does not use yet${this.state.version ? ` (version ${this.state.version})` : ''}. That is usually harmless. Nothing to do unless something stops working.`);
    return fresh;
  }

  /** You checked that this version works: later versions warn, this one does not. */
  confirm(version = this.state.version) {
    const v = parseVersion(version);
    if (!v) return false;
    this.state.tested = v; this.state.unknown = []; this.told.clear();
    this._save();
    return true;
  }

  status() {
    const s = this.state;
    const newer = !!(s.version && s.tested && compareVersions(s.version, s.tested) > 0);
    return { version: s.version, tested: s.tested, newer, unknown: s.unknown.slice(), seen: s.seen.slice(),
      text: !s.version ? 'No Claude Code version recorded yet (start an agent, or check that “claude” is on the PATH).'
        : `Claude Code ${s.version}. ${s.tested ? (newer ? `Newer than ${s.tested}, the version you confirmed.` : `Confirmed: ${s.tested}.`) : 'No version confirmed yet.'}${s.unknown.length ? ` Unknown hook fields: ${s.unknown.map((u) => u.field).join(', ')}.` : ''}` };
  }
}

/** The telemetry's resource attributes carry the version of the program that sent it. */
function versionFromTelemetry(body) {
  for (const key of ['resourceMetrics', 'resourceLogs']) {
    for (const r of (body && body[key]) || []) {
      const list = (r.resource && r.resource.attributes) || [];
      const get = (k) => { const a = list.find((x) => x && x.key === k); return a && a.value ? String(a.value.stringValue || '') : ''; };
      const v = parseVersion(get('service.version'));
      if (v && (!get('service.name') || /claude/i.test(get('service.name')))) return v;
    }
  }
  return '';
}

module.exports = { KNOWN_FIELDS, parseVersion, compareVersions, Drift, versionFromTelemetry };
