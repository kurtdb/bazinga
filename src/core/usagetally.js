'use strict';
/**
 * What each agent terminal has used (from its telemetry), added up per run. A terminal reports running totals; a run can have
 * several terminals (a hand-over starts a second agent in the same folder), so the run's usage is the sum over its terminals.
 * Kept apart from the window code so it can be tested.
 */
const path = require('node:path');
const runstats = require('./runstats');

class UsageTally {
  /** @param {{estimate?: (snap) => number|null, every?: number, save?: (root, sum) => void, now?: () => number}} o */
  constructor({ estimate = () => null, every = 15000, save = () => {}, now = Date.now } = {}) {
    this.terms = new Map(); this.saved = new Map();
    this.estimate = estimate; this.every = every; this.save = save; this.now = now;
  }

  /** A telemetry snapshot for terminal `id`, working in `root`. Writes to the run at most every `every` ms. */
  update(id, root, snap) {
    if (!root || !snap) return false;
    const cost = snap.costUsd > 0 ? snap.costUsd : (this.estimate(snap) || 0);
    this.terms.set(id, { root, costUsd: cost, input: (snap.input || 0) + (snap.cacheRead || 0) + (snap.cacheCreation || 0), output: snap.output || 0 });
    const t = this.now();
    if (t - (this.saved.get(root) || 0) < this.every) return false;
    this.saved.set(root, t);
    this.save(root, this.sumFor(root));
    return true;
  }

  /** Totals of every terminal working in `root` (or in a folder below it). */
  sumFor(root) {
    const sum = { costUsd: 0, input: 0, output: 0 };
    for (const u of this.terms.values()) if (u.root === root || u.root.startsWith(root + path.sep)) { sum.costUsd += u.costUsd; sum.input += u.input; sum.output += u.output; }
    return sum;
  }

  /** The run's stats with the newest numbers folded in (they can be newer than what was last saved). */
  fold(stats, root) { return runstats.setUsage(stats, this.sumFor(root)); }
}

module.exports = { UsageTally };
