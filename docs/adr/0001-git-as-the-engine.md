# 1. Git as the engine

Status: accepted

## Context

Memex promises memory that is accountable (who wrote this, and why), time-travelable
(what did the brain know on date X) and shareable across a Mac and a Windows machine.
Each of those could be built as its own feature: an audit table, a version store, a sync
protocol. Together that is a lot of bespoke machinery to get wrong.

## Decision

The vault is a plain git repository of markdown files, separate from the code repo.
Every note write is exactly one commit, authored as the writing agent, with the note id
and the `why` in the message. All git calls go through one serialized promise queue
(`src/git.ts`) so concurrent writers never fight over `.git/index.lock`. Memex never
pushes on its own; syncing is an explicit `pull --rebase` then `push`.

## Consequences

- Provenance, history and diffs come from `git log` and `git diff` at no extra cost.
- Multi-machine sync is a private remote; offline-first for free.
- Provenance is also copied into frontmatter, because commits are awkward to query and
  are lost by copy, squash or rebase. Git is the audit trail, frontmatter the fast path.
- Git must be installed, and Windows runners make git-touching tests slow, so those
  tests are kept few and use a real temp repository rather than a mock.
