# 3. MiniSearch over SQLite FTS5

Status: accepted

## Context

The first design used `better-sqlite3` with FTS5 for keyword search. That is a native
module: prebuilds break on Node upgrades, and a source build means debugging node-gyp
on Windows. Memex must install cleanly on a Mac and a Windows machine with no toolchain.

## Decision

Use MiniSearch, a pure TypeScript full-text engine. It gives BM25-style ranking, field
boosts, prefix and fuzzy matching, and serializes to JSON, which is what gets written
to `.memex/index.json`. A personal vault of a few hundred to a few thousand notes fits
comfortably in memory.

## Consequences

- Zero native dependencies; `npm install` just works on every platform.
- The "index is a rebuildable projection" story gets stronger: it is one JSON file.
- No SQL, no queries across structured columns; project and tag filters are applied in
  code. Acceptable at this scale.
- Memory use and load time grow with vault size. If a vault outgrows RAM, that is the
  trigger for the Postgres adapter described in ADR 2, not a reason to add SQLite now.
