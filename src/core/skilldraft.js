'use strict';
/**
 * Builds the one-shot task prompt for "Create a new skill with an agent's help" (Settings -> Skills). Drafting a
 * skill is just a normal agent run (core/runs.js) with a carefully-worded task - the agent IS the "LLM advice",
 * called through the one path this app already trusts for writing files (review + merge like any other run).
 * No separate LLM-calling code, no new IPC: this module only composes the text of that task.
 */
const { slug } = require('./skills');

const ADVICE = `Write the SKILL.md frontmatter carefully: Claude Code and other agents decide whether to load a skill from its "description" field alone, before reading anything else in the file.
- "name": a short kebab-case id.
- "description": one or two sentences covering BOTH what the skill does and WHEN it should trigger - concrete trigger phrases, file types, or situations. A vague description ("helps with testing") rarely gets picked; a specific one ("use when the user asks to write or review unit tests for a React component") does.
Keep the skill's own step-by-step instructions in SKILL.md's body, short enough to read in one go. Put anything long, optional, or only sometimes needed (reference material, a checklist, a script) in a separate file next to it and link to it from SKILL.md, instead of inlining everything.
Only write inside the target folder named below. Do not modify any other file.`;

/**
 * @param {{ name: string, purpose: string, skillsDir?: string, modelAfter?: string }} o
 * - name: the skill's name (sanitized with the same slug() used when installing a skill - see core/skills.js)
 * - purpose: free text from the user: what it should do and when an agent should reach for it
 * - skillsDir: the project's configured skills folder, relative to the project root (default .claude/skills)
 * - modelAfter: the name of an existing installed skill to read first, for this project's own conventions
 * @returns {string} the task text to pass to core/runs.js createRun()
 */
function buildTask({ name, purpose, skillsDir = '.claude/skills', modelAfter = '' } = {}) {
  const id = slug(name);
  if (!id) throw new Error('Give the skill a name.');
  const text = String(purpose || '').trim();
  if (!text) throw new Error('Describe what the skill should do.');
  const lines = [
    `Create a new agent skill at ${skillsDir}/${id}/SKILL.md.`,
    '',
    `What it should do, in the user's own words: ${text}`,
    '',
    ADVICE,
  ];
  if (modelAfter) lines.push('', `Before writing, read the existing skill at ${skillsDir}/${slug(modelAfter)}/SKILL.md for a sense of this project's own conventions (structure, tone, how detailed the instructions are) - match that style, but write entirely new content for this skill's own purpose.`);
  return lines.join('\n');
}

module.exports = { buildTask };
