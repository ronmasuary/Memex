# 2. Markdown is the truth; the index is a rebuildable, pluggable projection

Status: accepted

## Context

Search needs an index, and one day a team-shared semantic index (Postgres + pgvector).
If the index held data that markdown does not, losing it would mean losing memory, and
syncing it between machines would mean merging a binary artefact.

## Decision

Markdown files with YAML frontmatter are the only source of truth. The search index
lives in `<vault>/.memex/index.json`, is gitignored, is per-machine and can be deleted
at any time: `memex reindex` rebuilds it from the files. The index sits behind a narrow
interface (build, sweep, query, backlinks) so a Postgres + pgvector adapter later is an
implementation swap, not a data-model change.

## Consequences

- Nothing is ever lost by deleting `.memex/`; the index never causes a merge conflict.
- Staleness is handled by an mtime sweep before each query, re-parsing only changed
  files. No file watcher in v0.1 (editor temp files, duplicate events, Windows locks).
- Change detection hashes normalized text (LF, no BOM), so CRLF differences between
  machines do not look like edits.
- Gitignoring the index means each machine pays one rebuild after a pull.
