# 5. No HTTP framework, flat `src/`

Status: accepted

## Context

The UI needs a small read-only API: four GET endpoints (`/api/notes`, `/api/note/:id`,
`/api/graph`, `/api/conflicts`) plus a static directory. The obvious pick is Fastify with
`core/`, `mcp/` and `server/` folders. Memex is a personal tool that must install cleanly
on a Mac and a Windows machine, and every dependency is something a reviewer has to read past.

## Decision

Use Node's built-in `node:http`. The handler is one function, `(req, res, next?) => void`,
in `src/serve.ts`, about 200 lines including note rendering. The same function is mounted as
Vite dev middleware (non-API requests fall through via `next`), so `npm run dev` is a single
process with no proxy or CORS config. `src/` stays flat: one file per concern. The only
boundary rule is that `cli.ts` (and the Vite config, in dev) are the only importers of `serve.ts`.

## Consequences

- No framework dependency, no plugin API to learn, nothing to upgrade or audit.
- Routing, JSON errors, method checks and static serving are hand-written. That is fine
  for four routes; it would not be at forty, and that is the trigger to adopt a framework.
- No request validation layer or schema generation. Ids are checked against a slug pattern.
- The read API stays GET-only. Write actions (conflict resolution) will add routes later.
