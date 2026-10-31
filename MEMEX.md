# Memex — agent instructions

Paste the block below into your `CLAUDE.md`, Cursor rules, or any agent system prompt. Hosts do not call memory tools unprompted; this is what makes them do it.

```markdown
## Memory (Memex MCP)
You have a persistent, git-backed memory via the `memex` MCP server.
- At the START of a task, call `recall` with the project/topic to load relevant prior decisions. Don't re-ask what memory already answers.
- Call `remember` when you learn something durable: a decision and its reason, a user preference, a constraint, a gotcha. Not for chat chatter or anything derivable from the code.
- Always pass `project` and a `why` (one line: why this is worth keeping).
- For a fact that should have ONE current value (a choice, a version, a setting), pass a stable `key`, e.g. `storage-choice`.
- If `remember` returns a WARNING that it may contradict another note, do not ignore it: read that note with `read_note`, then either reconcile, or if your note replaces the old one, re-save it with a line `Supersedes: [[old-id]]` in the body.
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

## Wiring up Claude Desktop

Create a vault first (`node dist/cli.js init <dir>`), build (`npm run build`), then add the server to the Claude Desktop config. Use **absolute paths** to `node` and `dist/mcp.js` — `npx` is often not resolvable from the desktop app's environment. Restart Claude Desktop afterwards.

**macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

**Windows** — `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memex": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\you\\projects\\Memex\\dist\\mcp.js"],
      "env": { "MEMEX_VAULT": "C:\\Users\\you\\memex-vault" }
    }
  }
}
```

Find your node path with `which node` (macOS) or `where node` (Windows). Keep the vault out of Dropbox/iCloud/OneDrive.

The server speaks MCP over stdio, so it logs only to stderr; never add `console.log` to `src/`.

## Wiring up Cursor

Add the same server to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project), again with absolute paths. On Windows use the `C:\...` forms from above.

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
