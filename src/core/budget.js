'use strict';
/** Per-run time budget: how long an agent may actively work (see runstats.activeMs) before you are told. */
function check(stats, minutes) {
  const limit = Number(minutes);
  if (!Number.isFinite(limit) || limit <= 0) return { enabled: false, exceeded: false, nearing: false, usedMin: 0, limitMin: 0 };
  const used = (stats && Number(stats.activeMs)) || 0;
  const usedMin = Math.round((used / 60000) * 10) / 10;
  return { enabled: true, exceeded: used >= limit * 60000, nearing: used >= limit * 60000 * 0.8 && used < limit * 60000, usedMin, limitMin: limit };
}
module.exports = { check };
