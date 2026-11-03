---
name: Clean Code
description: Clean Code / SOLID / Clean Architecture review discipline (Uncle Bob mode) - small functions, intention-revealing names, single responsibility, dependency inversion at boundaries, tests as living documentation.
---

# Clean Code mode

Apply this while writing code and before calling a task finished - not as a separate pass at the end,
but as the standard you write to the first time. When reviewing a diff (your own or someone else's),
check it against these same points.

## Functions
- Small. A function should do one thing, do it well, and do it only. If you need "and" to describe
  what it does, split it.
- One level of abstraction per function. Don't mix "what" (business rule) with "how" (loop/parsing/IO)
  in the same function - extract the "how" into a named helper.
- Few arguments. Zero to two is comfortable; three needs a reason; four or more usually means the
  arguments want to be an object.
- No boolean flag arguments that change what the function does (`process(x, true)`). Split into two
  named functions instead - the call site should be readable without opening the function.

## Names
- Intention-revealing. A name should answer what it holds or does without needing a comment next to it.
  `elapsedTimeInDays` beats `d` with a comment saying "elapsed time in days".
- No encoded type/scope prefixes, no abbreviations that need decoding, no names that differ only by a
  number (`data1`, `data2`).
- Pick one word per concept across the codebase (don't mix `fetch`/`retrieve`/`get` for the same kind
  of operation) - consistency lets a reader guess correctly instead of re-checking every time.

## Comments
- A comment that explains *what* the code does is a sign the code should be rewritten to say that
  itself (better names, an extracted function) - delete the comment and fix the code instead.
- A comment earns its place when it explains *why*: a non-obvious constraint, a workaround for a
  specific bug, a reason this is slower/uglier than it looks like it should be. That kind of comment
  is worth keeping and worth writing.
- Don't comment out code "just in case" - delete it. Version control remembers it; a comment block
  doesn't tell a future reader whether it's safe to delete.

## Single Responsibility & SOLID
- A class/module should have one reason to change. If a change to formatting rules and a change to
  business rules both touch the same class, it has two responsibilities and should be split.
- Depend on abstractions at a boundary (an interface/port), not on a concrete implementation, when the
  concrete thing is something that could reasonably change or be swapped (a database, an external API,
  a file format) - this is what makes that boundary testable without the real thing.
- Prefer composition and small interfaces over deep inheritance hierarchies. A class open for extension
  should not require modifying its own source to add a new case (open/closed) - a new case should mean
  adding a new small class, not adding another `if`/`switch` branch to an existing one.

## Clean Architecture's one real rule: dependencies point inward
- Business rules (entities, use cases) must not know about frameworks, databases, UI, or any specific
  I/O mechanism. Those outer layers depend on the business rules' interfaces, never the other way round.
- A quick smoke test for a violation: if deleting the database driver or the web framework from the
  project would force you to change a business-rule class, the dependency points the wrong way.
- This is exactly what tools like ArchUnit check mechanically (e.g. "no classes in `..domain..` may
  depend on classes in `..infrastructure..`") - if this project has ArchUnit rules, treat a failure from
  them as seriously as a failing test, not as a lint nitpick to override.

## Tests as documentation
- A test's name and body should read as a specification of the behavior, not as a log of
  implementation steps. Someone who has never seen the production code should be able to read the test
  and understand what it guarantees.
- Keep tests fast and independent - a test that depends on another test's side effects or on run order
  is a design smell in the test, not just an inconvenience.
- Favor one clear assertion (or one clear behavior) per test over one giant test that checks everything
  at once - a failure should point at what broke, not require re-reading the whole test to find out.

## Boy Scout Rule
- Leave the code a little cleaner than you found it, scoped to what you're already touching - rename a
  misleading variable you had to read anyway, extract a function out of a block you just modified. Don't
  turn an unrelated bug fix into a drive-by rewrite of a file you didn't otherwise need to touch.

## DRY, held loosely
- Duplication of *knowledge* (the same business rule expressed twice) is the problem to remove - two
  pieces of code that happen to look similar today but represent different concepts are not duplication,
  and forcing them to share an abstraction too early usually makes both harder to change later.
