# Dogfood backlog

Findings from the 2026-11-05 end-to-end dogfood — a lightweight (Sonnet) agent built a
small CLI todo app from scratch using Memex as its working memory. No bugs were found;
these are UX and eval improvements.

## UX

- [ ] **Surface the note-id slug rule.** You only learn a note's id *after* saving, yet
  you need it to pre-write `[[id]]` wikilinks. Document the slug rule, and/or return the
  resolved id from `remember` before the commit.
- [ ] **Sentence-aware recall snippets.** `recall` snippets truncate mid-sentence, forcing
  a `read_note` for anything substantial. Consider a sentence boundary, or a longer snippet
  for the top hit.
- [ ] **Distinguish empty project from bad query in `recall`.** An empty project returns a
  bare "No matching notes," same as a genuine miss. A hint like "0 notes in project X"
  would disambiguate.

## Evals / coverage

- [ ] **Exercise the contradiction warning in the dogfood/eval.** A naive single build uses
  distinct keys and never trips it. Add a step that deliberately reuses a `key` with a new
  value and asserts the WARNING fires.

## Insight

- Single-session builds barely benefit from memory — `recall` mostly *confirms* what is
  still in context rather than recovering anything lost. Memex's value shows **across
  sessions / after context loss**, so dogfoods and evals should span multiple sessions.
