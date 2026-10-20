'use strict';
/**
 * When is an OS notification worth showing? Only when you are not looking at the IDE, and only for things you'd want to know about.
 * kinds: 'agent-idle' (an agent stopped and waits for you), 'agent-prompt' (an agent asks for permission), 'checks-done', 'fixloop' (clean / gave up / needs you)
 */
const KINDS = new Set(['agent-idle', 'agent-prompt', 'checks-done', 'fixloop']);

function shouldNotify({ enabled, focused, kind, minimized = false, kinds = null }) {
  if (!enabled || !KINDS.has(kind)) return false;
  if (Array.isArray(kinds) && !kinds.includes(kind)) return false; // the oversight level may narrow which kinds interrupt you
  return !focused || minimized;
}

/** Short human text for a fix-loop status event. */
function fixLoopMessage(evt) {
  const who = evt.label || 'Agent';
  switch (evt.state) {
    case 'done': return { title: `${who}: gates are green`, body: evt.reason };
    case 'stop': return { title: `${who} needs you`, body: `Fix loop stopped: ${evt.reason}` };
    case 'escalating': return { title: `${who}: handed over`, body: evt.reason };
    case 'error': return { title: `${who}: fix loop could not run the gates`, body: evt.reason };
    default: return null; // checking / fixing: not worth interrupting for
  }
}

module.exports = { shouldNotify, fixLoopMessage };
