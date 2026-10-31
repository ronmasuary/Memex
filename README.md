# 🧠 Memex

**Give your AI agents a persistent, linkable brain** — a markdown wiki they read and write over [MCP](https://modelcontextprotocol.io).

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D20-3c873a)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6)

Agents forget everything between sessions. Memex gives them a memory that **persists, links, and stays accountable**: a git-backed markdown knowledge base that any MCP host (Claude Desktop, Cursor, your own agent) can read and write. Your notes are plain `.md` files you own, not rows in someone's database.

> **Status:** v0.2, usable. Six MCP tools, contradiction warnings, a browse UI and a force-directed graph. See the [roadmap](#roadmap).

## Accountable memory that doesn't rot

Most "agent memory" is a bucket of embeddings that silently rots: stale facts linger, contradictions pile up, and you can never ask *why* the agent believes something. Memex is built on one engine, **git**:

| Pillar | What it means | Powered by |
|---|---|---|
| **Provenance** | Every note records which agent and session wrote it, when, and why. One write is exactly one commit. | frontmatter + git commits |
| **Contradiction detection** | A write that collides with an existing note on the same `key` comes back to the agent as a warning: "this may contradict note Y". | deterministic checks |
| **Time-travel** | Ask what the brain knew on date X, and diff any two points. *(v0.4)* | git history |

The detector is tuned to **under-flag**, because a tool that cries wolf is dead by lunchtime. Its [correctness suite](src/conflicts.fixtures.ts) is mostly cases that assert *nothing* flags (restatements, explicit supersedes, unrelated notes with similar wording). It is the seed of an evals story, not one yet.

## Quickstart (about 60 seconds)

Needs Node 20+ and git.

```bash
git clone https://github.com/ronmasuary/Memex.git && cd Memex
npm install && npm run build           # MCP server + CLI -> dist/
npm --prefix web install && npm --prefix web run build   # browse UI -> web/dist
node dist/cli.js init ~/memex-vault    # creates a git repo with a seed note
node dist/cli.js serve --vault ~/memex-vault   # http://127.0.0.1:4321
```

Keep the vault out of Dropbox, iCloud and OneDrive (cloud sync plus git corrupts `.git`). `memex find <query>` searches from the terminal.

## Connect an MCP host

Use **absolute paths** to `node` and `dist/mcp.js`; `npx` is often not resolvable from desktop apps. Find node with `which node` (macOS) or `where node` (Windows), then restart the host.

**Claude Desktop, macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memex": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/projects/Memex/dist/mcp.js"],
      "env": { "MEMEX_VAULT": "/Users/you/memex-vault" }
    }
  }
}
```

**Claude Desktop, Windows** — `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memex": {
      "command": "C:\Program Files\nodejs\node.exe",
      "args": ["C:\Users\you\projects\Memex\dist\mcp.js"],
      "env": { "MEMEX_VAULT": "C:\Users\you\memex-vault" }
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project); same shape, same absolute-path rule:

```json
{
  "mcpServers": {
    "memex": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/projects/Memex/dist/mcp.js"],
      "env": { "MEMEX_VAULT": "/Users/you/memex-vault" }
    }
  }
}
```

Hosts don't call memory tools unprompted. Paste the short block from [MEMEX.md](MEMEX.md) into your `CLAUDE.md` or Cursor rules so the agent actually uses them.

## MCP tools

| Tool | Purpose |
|---|---|
| `remember` | Create or update a note, one git commit, returns contradiction warnings |
| `recall` | Ranked search: title, id, 200-char snippet, max 8 hits |
| `read_note` | Full body of one note, capped by `maxChars` |
| `get_backlinks` | Notes that link to a given note |
| `list_notes` | Browse by project or tag |
| `list_tags` | Tags with counts |

Every tool caps its output so a memory lookup never floods the host's context.

## The web UI

`memex serve` is a read-only browser for the vault: notes grouped by project, rendered markdown with clickable `[[wikilinks]]`, a backlinks panel, a provenance badge, and a **force-directed graph** of notes and links (`/graph`). In the graph, color is the project, size is backlink count, hover shows the title, click opens the note, and the project and tag filters re-lay-out what is left. It follows your system light/dark setting.

## How it works

- **Source of truth:** markdown + YAML frontmatter, one note per file (`<project>/<slug>.md`), in a git repo separate from this one.
- **Index:** a rebuildable, gitignored [MiniSearch](https://github.com/lucaong/minisearch) projection, refreshed by an mtime sweep. No native dependencies. Postgres + pgvector can slot in later behind the same interface.
- **Multi-machine:** the vault is a git remote; clone it on your Mac and your Windows box.
- **Stack:** TypeScript (Node 20, ESM), `@modelcontextprotocol/sdk`, `node:http` (no framework), React + Vite + Tailwind, `d3-force` with hand-written SVG. CI on ubuntu, macOS and Windows. Decisions are recorded in [docs/adr](docs/adr).

## Roadmap

- [x] **v0.1 — Brain.** Markdown store, MCP read/write/search, contradiction warnings.
- [x] **v0.2 — Graph.** Wikilinks, backlinks, browse UI and the force-directed graph.
- [ ] **v0.3 — Conflicts.** The contradiction inbox and resolve actions.
- [ ] **v0.4 — Time-travel.** Scrub the brain's history; diff any two points.
- [ ] **v0.5 — Recall.** Embeddings and hybrid semantic search on Postgres + pgvector (Docker lands here).
- [ ] **v0.6 — Obsidian sync.** Point Memex at a real Obsidian vault, two-way.
- [ ] **Later:** team and shared memory, a LangGraph memory adapter.

## Contributing

Issues and ideas welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed [MIT](LICENSE) © Ron Masuary.
