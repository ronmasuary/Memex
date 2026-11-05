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
- [x] **The detector may be too hard to trip in practice.** In the cold second session, an
  agent wrote a note with the existing `key: storage-choice` and a different value (SQLite),
  explicitly saying "Conflicts with [[adr-0002]]" — and NO warning fired, because the note
  also mentioned "JSON" (shared token) and was framed as an unimplemented *proposal*. This is
  defensible under-flagging, but it means the headline feature is hard to surface naturally.
  **Fixed (surgical).** `differingValues` rule (a) in `src/conflicts.ts` no longer grants
  blanket immunity on *any* shared value token. It now compares each side's **distinctive**
  values (those the other side lacks): it flags only when **both** sides assert at least one
  distinctive value, so incidental overlap (`json`, `TODO_FILE`) can't mask a real
  JSON-file-vs-SQLite contradiction. A note whose values are a *subset* of the other's
  (a restatement or a refinement) still has no distinctive value, so it stays silent — as do
  explicit `Supersedes:`/`Reconciled with:` pairs, which are short-circuited upstream. New
  fixtures `g1` (the positive) and `g2`–`g4` (restatement/supersede/reconcile guards, all
  silent despite overlap) lock this in.

## Insight

- Single-session builds barely benefit from memory — `recall` mostly *confirms* what is
  still in context rather than recovering anything lost. Memex's value shows **across
  sessions / after context loss**, so dogfoods and evals should span multiple sessions.
