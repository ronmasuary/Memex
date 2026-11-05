# Memex — agent instructions

Paste the block below into your `CLAUDE.md`, Cursor rules, or any agent system prompt. Hosts do not call memory tools unprompted; this is what makes them do it.

```markdown
## Memory (Memex MCP)
You have a persistent, git-backed memory via the `memex` MCP server.
- At the START of a task, call `recall` with the project/topic to load relevant prior decisions. Don't re-ask what memory already answers.
- Call `remember` when you learn something durable: a decision and its reason, a user preference, a constraint, a gotcha. Not for chat chatter or anything derivable from the code.
- Always pass `project` and a `why` (one line: why this is worth keeping).
- For a fact that should have ONE current value (a choice, a version, a setting), pass a stable `key`, e.g. `storage-choice`.
- If `remember` returns a WARNING that it may contradict another note, do not ignore it: read that note with `read_note`, then either reconcile, or if your note replaces the old one, re-save it with a line `Supersedes: [[old-id]]` in the body. Use `resolve_conflict` only after the user has said which side is right.
- Link related notes with `[[note-id]]`. Use `get_backlinks`, `list_notes`, `list_tags` to browse.
- `recall` returns short snippets; use `read_note` for the full text.
```

## Tools

| Tool | Purpose |
|---|---|
| `remember(title, body, project?, tags?, key?, why?)` | Create/update a note; one git commit; returns contradiction warnings |
| `recall(query, project?, limit=8)` | Ranked hits: title, id, 200-char snippet (max 8) |
| `read_note(id, maxChars?)` | Full body (default 6000 chars, max 20000) |
| `get_backlinks(id)` | Notes linking here |
| `list_notes(project?, tag?, limit?)` | Browse (default 50, max 100) |
| `list_tags(project?)` | Tags with counts |
| `resolve_conflict(a, b, action, note?, why?)` | `keep_a`, `keep_b` or `keep_both` (needs `note`); one commit |

## Wiring up Claude Desktop or Cursor

Build and create a vault first (`npm run setup`, then `memex init <dir>`), then let Memex print the config block with absolute paths already resolved — `npx` and PATH `bin`s are often not resolvable from desktop apps:

```bash
memex mcp-config --vault <dir>              # Claude Desktop (default)
memex mcp-config --vault <dir> --host cursor # Cursor
```

It prints a ready-to-paste `mcpServers` block and names the config file to merge it into for your OS (Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows; Cursor: `~/.cursor/mcp.json` global or `.cursor/mcp.json` per project). Merge it, then **fully restart the host**. Keep the vault out of Dropbox/iCloud/OneDrive.

The server speaks MCP over stdio, so it logs only to stderr; never add `console.log` to `src/`.
