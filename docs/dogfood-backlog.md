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
  **Fixed (surgical).** `differingValues` rule (a) in `src/conflicts.ts` no longer grants blanket
  immunity on *any* shared value token. It compares each side's **distinctive** values (those the
  other side lacks): a subset (restatement/refinement) stays silent; with **no** shared token the
  notes plainly disagree and any distinctive value flags (unchanged no-overlap behaviour). When the
  notes **do** share a token, it flags only if each side's distinctive set carries a **hard** value
  — a `code span`, a dotted/underscored identifier, or a token with a digit (what a real contested
  value looks like: a filename, path, key, version). So the JSON-file-vs-SQLite miss (`todos.json`
  vs `todos.db` under shared `json`/`TODO_FILE`) now flags, while a bare proper-noun difference under
  overlap (`Postgres, on AWS` vs `Postgres, via PgBouncer`) stays silent — those are as likely
  complementary facets as a clash, and crying wolf is the fatal mode. Explicit `Supersedes:`/
  `Reconciled with:` pairs are short-circuited upstream regardless. New fixtures: `g1` (positive,
  hard values flag), `g2`–`g4` (restatement/supersede/reconcile guards), `g5`–`g6` (soft-overlap
  boundary: complementary facets and a deliberately-missed proper-noun swap, both silent).

## Insight

- Single-session builds barely benefit from memory — `recall` mostly *confirms* what is
  still in context rather than recovering anything lost. Memex's value shows **across
  sessions / after context loss**, so dogfoods and evals should span multiple sessions.

## Web UI

- [ ] **Graph zoom/fit icon buttons drift off the bottom-right edge and are only partially
  visible.** The zoom-in / zoom-out / fit-to-screen controls aren't fully anchored inside the
  canvas padding, so at some sizes they clip past the bottom-right corner. Anchor them within
  the visible canvas and keep them fully on-screen at all viewport widths.
