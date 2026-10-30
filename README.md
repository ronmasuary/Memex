# 🧠 Memex

**Give your AI agents a persistent, linkable brain** — a markdown wiki they read and write over [MCP](https://modelcontextprotocol.io).

![status](https://img.shields.io/badge/status-early%20WIP-f5a623)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D20-3c873a)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6)

Agents forget everything between sessions. Memex gives them a memory that **persists, links, and stays accountable** — a git-backed markdown knowledge base any MCP host (Claude Desktop, Cursor, your own agent) can read and write. Your notes are plain `.md` files you own, not rows in someone's database.

> **Status:** pre-release. The scaffold (CI, tooling, docs) is in place; the engine lands milestone by milestone — see the [roadmap](#roadmap). Watch/star to follow along. ⭐

---

## Why not just a vector DB?

Most "agent memory" is a bucket of embeddings that silently rots: stale facts linger, contradictions pile up, and you can never ask *why* the agent believes something. Memex is built on one idea:

### 🔑 Accountable memory that doesn't rot

Three things, unified by a single engine — **git**:

| Pillar | What it means | Powered by |
|---|---|---|
| **Provenance** | Every note records *which agent/model/session* wrote it, *when*, and *why*. Trust is adjustable and revocable. | git commits (author + message + diff) |
| **Contradiction detection** | A new write that collides with an existing note opens a **conflict**, resolved by provenance, recency, and trust — so the brain doesn't quietly hold two truths. | diff + deterministic checks |
| **Time-travel** | Ask *"what did the brain know on date X?"* and diff any two points in its history. | git history |

**The pitch:** your agent's memory is a git repo it can reason about — accountable, time-travelable, and self-auditing.

---

## How it works

- **Source of truth:** markdown + YAML frontmatter, one note per file, **git-backed**. Human-readable, diffable, yours.
- **Index:** a swappable, rebuildable projection — local keyword search now, **Postgres + pgvector** (semantic recall + team memory) later. Swapping it is an adapter change, never a data migration.
- **Multi-machine:** the vault is a git remote. Clone it on your Mac *and* your Windows box; pull/push to sync. Offline-first; edit collisions become merges become the same conflict-resolution flow.
- **Multi-project:** `project:` is a first-class namespace, so one brain can hold notes for everything you're building — scope the graph and search per-project or span them all.

### MCP tool surface

`search_notes` · `read_note` · `write_note` · `get_backlinks` · `list_tags` · `list_notes`
plus ergonomic `remember` / `recall` wrappers, with notes exposed as MCP **resources**.

### A web UI you'd actually open

A browsable wiki (rendered markdown, backlinks panel, provenance badge) and a **force-directed graph** of your notes and `[[wikilinks]]` — colored by tag, filterable by project.

---

## Roadmap

- [ ] **v0.1 — Brain.** Markdown store + MCP read/write/search. *Usable headless.*
- [ ] **v0.2 — Graph.** `[[wikilinks]]`, backlinks, tags + the force-directed graph view.
- [ ] **v0.3 — Conflicts.** The contradiction-detection inbox — the differentiator.
- [ ] **v0.4 — Time-travel.** Scrub the brain's history; diff any two points.
- [ ] **v0.5 — Recall.** Embeddings + hybrid semantic search on Postgres + pgvector.
- [ ] **v0.6 — Obsidian sync.** Point Memex at a real Obsidian vault, two-way.
- [ ] **Later** — team / shared memory · LangGraph memory adapter.

---

## Tech

TypeScript (Node 20, ESM) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol) · `gray-matter` · `simple-git` · React + Vite · `vitest`. Cross-platform (macOS + Windows), CI on all three OSes.

## Contributing

Early days — issues and ideas welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Ron Masuary
