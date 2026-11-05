# Notice

This skill is a copy of `ub-mode` from Robert C. Martin's repository
https://github.com/unclebob/ub-mode, licensed under the MIT License
(see LICENSE in this folder).

The only change made for this bundled copy: the YAML frontmatter's folded
`description: >` block was flattened to a single quoted line, because
Bazinga's own (non-YAML) SKILL.md preview parser only reads a single line
after `description:` - Claude Code's own frontmatter reader accepts either
form equally. The skill's instructions are otherwise unchanged.

`ub-mode` itself references companion CLI tools (`unclebob/crapper`,
`unclebob/dryer`, `unclebob/mutator`, `unclebob/uml-viewer`) that are not
bundled here - install them separately if you want the skill's CRAP-score,
duplication and mutation-testing steps to run for real.
