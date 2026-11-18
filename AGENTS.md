# Memex — agent instructions

A git-backed, markdown-based knowledge base exposed to AI agents over MCP.
Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing how notes, git or the
index interact — most of the design constraints live there, with reasons.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run build       # server + CLI -> dist/
npm run setup       # one-shot: root + web installs and both builds
```

All three checks (`typecheck`, `lint`, `test`) run in CI on Linux, macOS and
Windows against Node 20. Run them locally before proposing a change.

## Conventions

- **ESM only.** `"type": "module"`, `moduleResolution: NodeNext`. Relative
  imports must carry the `.js` extension (`./vault.js`), even though the
  source is `.ts`. Omitting it compiles but fails at runtime.
- **No `console` in `src/**`** except `console.error` — enforced by eslint.
  CLI results go to stdout through the explicit writer in `cli.ts`,
  diagnostics go to stderr.
- **Tests are colocated**: `src/foo.ts` is tested by `src/foo.test.ts`. There
  is no separate `tests/` tree.
- **`strict` plus `noUncheckedIndexedAccess`.** Indexing an array yields
  `T | undefined`; handle it rather than asserting it away.
- **Never commit `.memex/`.** It is a rebuildable MiniSearch index, not data.
- Source lives in `src/` (`rootDir`), build output in `dist/`. Never edit
  `dist/` by hand.

## Git discipline in the vault

These are invariants of the product, not style preferences:

- One write is exactly **one commit**, authored as the writing agent, with the
  note id, the `why` and the session id in the message.
- All git calls in a process go through the single promise queue in `git.ts`.
  Concurrent writers hitting `.git/index.lock` is a real failure mode.
- **Nothing is ever deleted.** Resolving a conflict marks the loser
  `superseded` and links it to the winner. The history is the record.

## Memory (Memex MCP)

You have a persistent, git-backed memory via the `memex` MCP server.

- At the START of a task, call `recall` with the project/topic to load relevant prior decisions. Don't re-ask what memory already answers.
- Call `remember` when you learn something durable: a decision and its reason, a user preference, a constraint, a gotcha. Not for chat chatter or anything derivable from the code.
- Always pass `project` and a `why` (one line: why this is worth keeping).
- For a fact that should have ONE current value (a choice, a version, a setting), pass a stable `key`, e.g. `storage-choice`.
- If `remember` returns a WARNING that it may contradict another note, do not ignore it: read that note with `read_note`, then either reconcile, or if your note replaces the old one, re-save it with a line `Supersedes: [[old-id]]` in the body. Use `resolve_conflict` only after the user has said which side is right.
- Link related notes with `[[note-id]]`. Use `get_backlinks`, `list_notes`, `list_tags` to browse.
- `recall` returns short snippets; use `read_note` for the full text.
