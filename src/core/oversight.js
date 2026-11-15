'use strict';
/**
 * Human-in-the-loop levels: how much of the agent's work you want to see and approve.
 * A level is a preset for settings that already exist (fix loop, merge guard, notifications) plus a prompt prefix.
 *
 * Layers, later wins:  defaults < IDE level < IDE settings < project level < project config
 * The level can be set in the IDE settings (`oversight`) and in `.ide/config.json` (`oversight`); the project wins.
 */
const LEVELS = {
  autonomous: {
    label: 'Autonomous',
    summary: 'The agent works alone: gates and related tests loop back to it; you look at the result.',
    config: {
      fixLoop: { enabled: true, maxRounds: 5, relatedTests: true },
      mergeGuard: { errors: 'block', tests: 'block', protectedPaths: 'block', scope: 'warn', unreviewed: 'off', summary: 'off', gatesNotRun: 'warn', bugfixTest: 'warn', dependencies: 'warn' },
      // "Autonomous" is the level that already lets the fix loop and merge guard run unattended; auto-merge finishing
      // the job (once the guard is clean and the scorecard backs it) is the natural extension of that, so this level
      // defaults it on. minWinRate/dryRun/kinds stay whatever the user already has (see oversight.DEEP_KEYS).
      autoMerge: { enabled: true },
      notifyKinds: ['agent-prompt', 'fixloop'],
      taskPrefix: '',
    },
  },
  supervised: {
    label: 'Supervised',
    summary: 'The fix loop runs; you review before merging. Blockers for errors, weakened tests and protected paths.',
    config: {
      fixLoop: { enabled: true, maxRounds: 3, relatedTests: false },
      mergeGuard: { errors: 'block', tests: 'block', protectedPaths: 'block', scope: 'warn', unreviewed: 'warn', summary: 'warn', gatesNotRun: 'warn', bugfixTest: 'warn', dependencies: 'warn' },
      notifyKinds: ['agent-idle', 'agent-prompt', 'checks-done', 'fixloop'],
      taskPrefix: '',
    },
  },
  guided: {
    label: 'Guided',
    summary: 'The agent writes a plan first and waits for you; no automatic fix loop; every file must be reviewed before merging.',
    config: {
      fixLoop: { enabled: false },
      mergeGuard: { errors: 'block', tests: 'block', protectedPaths: 'block', scope: 'block', unreviewed: 'block', summary: 'warn', gatesNotRun: 'block', bugfixTest: 'block', dependencies: 'block', testsImmutable: 'warn' },
      notifyKinds: ['agent-idle', 'agent-prompt', 'checks-done', 'fixloop'],
      taskPrefix: 'Before you change any file, write a short plan (what you will change and why) and wait for my approval.',
    },
  },
  stepwise: {
    label: 'Step by step',
    summary: 'Plan first, then small steps; the agent stops after each one and waits for your feedback. Strictest merge guard.',
    config: {
      fixLoop: { enabled: false },
      mergeGuard: { errors: 'block', tests: 'block', protectedPaths: 'block', scope: 'block', unreviewed: 'block', summary: 'block', gatesNotRun: 'block', bugfixTest: 'block', dependencies: 'block', testsImmutable: 'block' },
      notifyKinds: ['agent-idle', 'agent-prompt', 'checks-done', 'fixloop'],
      taskPrefix: 'Start with a short plan and wait for my approval. Then work in small steps: after each step, stop, say what you changed, and wait for my feedback before you continue.',
    },
  },
};

const ids = () => Object.keys(LEVELS);
const isLevel = (x) => typeof x === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, x);
const presetFor = (level) => (isLevel(level) ? LEVELS[level].config : {});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Keys whose objects are merged field by field across layers; every other key is replaced as a whole. */
const DEEP_KEYS = ['fixLoop', 'mergeGuard', 'agentContainer', 'autoMerge', 'keybindings'];

/**
 * @param {object[]} layers  config layers in order, later wins; each may carry `oversight`
 * The layers are expanded so a layer's level preset comes just before that layer's own explicit values.
 */
function mergeLayers(layers) {
  const expanded = [];
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    if (isLevel(layer.oversight)) expanded.push(presetFor(layer.oversight));
    expanded.push(layer);
  }
  const merged = {};
  for (const layer of expanded) {
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === null) { if (!(k in merged)) merged[k] = v; continue; }
      if (DEEP_KEYS.includes(k) && isObj(v) && isObj(merged[k])) merged[k] = { ...merged[k], ...v };
      else merged[k] = isObj(v) ? { ...v } : v;
    }
  }
  return merged;
}

/** Which level is in force and where it comes from: { level, source: 'project'|'ide'|null }. */
function effectiveLevel(ideSettings, projectConfig) {
  if (projectConfig && isLevel(projectConfig.oversight)) return { level: projectConfig.oversight, source: 'project' };
  if (ideSettings && isLevel(ideSettings.oversight)) return { level: ideSettings.oversight, source: 'ide' };
  return { level: null, source: null };
}

function describe(ideSettings, projectConfig) {
  const { level, source } = effectiveLevel(ideSettings, projectConfig);
  if (!level) return { level: null, source: null, label: 'Custom', summary: 'No level set: the individual settings apply.' };
  const l = LEVELS[level];
  const overridden = source === 'project' && isLevel(ideSettings && ideSettings.oversight) && ideSettings.oversight !== level ? ideSettings.oversight : null;
  return { level, source, label: l.label, summary: l.summary, overridesIde: overridden, details: l.config };
}

module.exports = { LEVELS, ids, isLevel, presetFor, mergeLayers, effectiveLevel, describe, DEEP_KEYS };
