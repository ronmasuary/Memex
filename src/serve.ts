import MarkdownIt from "markdown-it";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBacklinks, extractWikilinks } from "./links.js";
import { SearchIndex } from "./search.js";
import { slugify } from "./slug.js";
import type { Note, Vault } from "./vault.js";

export const DEFAULT_PORT = 4321;

/** Built UI, relative to this file: `src/serve.ts` and `dist/serve.js` both sit one level below the repo root. */
export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface NoteSummary {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: Note["status"];
  updated: string;
  path: string;
}

function summarize(n: Note): NoteSummary {
  return { id: n.id, title: n.title, project: n.project, tags: n.tags, status: n.status, updated: n.updated, path: n.path };
}

/** markdown-it with `[[wikilinks]]` resolved against the set of known note ids passed in `env.ids`. Raw HTML is off. */
function createRenderer(): InstanceType<typeof MarkdownIt> {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const src = state.src;
    if (src.charCodeAt(state.pos) !== 0x5b || src.charCodeAt(state.pos + 1) !== 0x5b) return false;
    const end = src.indexOf("]]", state.pos + 2);
    if (end < 0) return false;
    const inner = src.slice(state.pos + 2, end);
    if (inner.includes("\n") || inner.includes("[")) return false;
    const [targetAndHeading = "", alias] = inner.split("|", 2);
    const target = targetAndHeading.split("#", 1)[0] ?? "";
    const id = slugify(target);
    if (!id) return false;
    if (!silent) {
      const ids = (state.env as { ids?: Set<string> }).ids;
      const exists = ids?.has(id) ?? false;
      const open = state.push("wikilink_open", "a", 1);
      open.attrSet("href", exists ? `/note/${id}` : "#");
      open.attrSet("class", exists ? "wikilink" : "wikilink missing");
      open.attrSet("data-id", id);
      if (!exists) open.attrSet("title", "No such note");
      state.push("text", "", 0).content = (alias ?? target).trim() || id;
      state.push("wikilink_close", "a", -1);
    }
    state.pos = end + 2;
    return true;
  });
  return md;
}

export interface HandlerOptions {
  vault: Vault;
  /** Directory of the built UI. When absent or missing, non-API requests fall through (or 404). */
  webDist?: string;
}

export type NextFn = (err?: unknown) => void;
export type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse, next?: NextFn) => void;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

/**
 * Read-only HTTP handler: JSON under `/api/*`, built UI everywhere else. Framework-free on purpose (ADR 5).
 * The same handler is mounted as Vite dev middleware, where `next` passes non-API requests on to Vite.
 */
export function createHandler(opts: HandlerOptions): RequestHandler {
  const { vault } = opts;
  const index = new SearchIndex(vault);
  const md = createRenderer();

  async function loadNotes(): Promise<Note[]> {
    const paths = await vault.listNotePaths();
    return Promise.all(paths.map((p) => vault.readNote(p)));
  }

  async function api(route: string, url: URL, res: http.ServerResponse): Promise<void> {
    if (route === "/api/notes") {
      const project = url.searchParams.get("project");
      const tag = url.searchParams.get("tag");
      let notes = (await loadNotes()).map(summarize);
      const counts = new Map<string, number>();
      for (const n of notes) counts.set(n.project, (counts.get(n.project) ?? 0) + 1);
      if (project) notes = notes.filter((n) => n.project === project);
      if (tag) notes = notes.filter((n) => n.tags.includes(tag));
      notes.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
      const projects = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
      const body: Record<string, unknown> = { notes, projects };
      if (url.searchParams.get("group") === "project") {
        const groups = new Map<string, NoteSummary[]>();
        for (const n of notes) groups.set(n.project, [...(groups.get(n.project) ?? []), n]);
        body.groups = [...groups].map(([name, list]) => ({ project: name, notes: list })).sort((a, b) => a.project.localeCompare(b.project));
      }
      return sendJson(res, 200, body);
    }

    if (route.startsWith("/api/note/")) {
      let id: string;
      try {
        id = decodeURIComponent(route.slice("/api/note/".length));
      } catch {
        return sendJson(res, 400, { error: "bad note id" });
      }
      if (!ID_PATTERN.test(id)) return sendJson(res, 404, { error: `no such note: ${id}` });
      const notes = await loadNotes();
      const note = notes.find((n) => n.id === id);
      if (!note) return sendJson(res, 404, { error: `no such note: ${id}` });
      const byId = new Map(notes.map((n) => [n.id, n]));
      const html = md.render(note.body, { ids: new Set(byId.keys()) });
      const backlinks = (await index.backlinks(id)).flatMap((src) => {
        const n = byId.get(src);
        return n ? [{ id: n.id, title: n.title, project: n.project }] : [];
      });
      const links = extractWikilinks(note.body).map((target) => ({
        id: target,
        title: byId.get(target)?.title ?? target,
        exists: byId.has(target),
      }));
      const { source, session, why, created, updated } = note;
      return sendJson(res, 200, {
        note: { ...summarize(note), key: note.key ?? null, created, body: note.body },
        html,
        provenance: { source, session, why, created, updated },
        backlinks,
        links,
      });
    }

    if (route === "/api/graph") {
      const notes = await loadNotes();
      const ids = new Set(notes.map((n) => n.id));
      const sources = notes.map((n) => ({ id: n.id, links: extractWikilinks(n.body) }));
      const backlinks = buildBacklinks(sources);
      const edges = sources.flatMap((s) =>
        s.links.filter((t) => t !== s.id && ids.has(t)).map((t) => ({ source: s.id, target: t })),
      );
      const nodes = notes.map((n) => ({
        id: n.id,
        title: n.title,
        project: n.project,
        tags: n.tags,
        status: n.status,
        backlinks: backlinks.get(n.id)?.length ?? 0,
      }));
      return sendJson(res, 200, { nodes, edges });
    }

    if (route === "/api/conflicts") {
      const conflicts = (await loadNotes())
        .filter((n) => n.status === "conflict")
        .map((n) => ({ ...summarize(n), key: n.key ?? null }));
      return sendJson(res, 200, { conflicts });
    }

    return sendJson(res, 404, { error: "unknown API route" });
  }

  async function serveStatic(pathname: string, method: string, res: http.ServerResponse): Promise<boolean> {
    const dist = opts.webDist;
    if (!dist || !existsSync(dist)) return false;
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    let file = path.resolve(dist, `.${rel}`);
    const inside = file === dist || file.startsWith(dist + path.sep);
    if (!inside) return false;
    let info = await stat(file).catch(() => undefined);
    if (info?.isDirectory() || !info) {
      // Client-side routes (/note/:id) fall back to the app shell; missing assets stay 404.
      if (path.extname(rel)) return false;
      file = path.join(dist, "index.html");
      info = await stat(file).catch(() => undefined);
      if (!info) return false;
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": type, "cache-control": cache, "content-length": info.size });
    res.end(method === "HEAD" ? undefined : await readFile(file));
    return true;
  }

  return (req, res, next) => {
    void (async () => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
      if (method !== "GET" && method !== "HEAD") {
        if (!isApi && next) return next();
        res.setHeader("allow", "GET, HEAD");
        return sendJson(res, 405, { error: "read-only API: GET only" });
      }
      try {
        if (isApi) return await api(url.pathname.replace(/\/+$/, ""), url, res);
        if (next) return next();
        if (await serveStatic(url.pathname, method, res)) return;
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found. If you expected the UI, run `npm --prefix web run build` first.");
      } catch (err) {
        console.error("memex serve:", err);
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
        else res.end();
      }
    })();
  };
}

export interface ServeOptions extends HandlerOptions {
  port?: number;
  host?: string;
}

/** Start the server on loopback (the vault is private; never bind a public interface by default). */
export function startServer(opts: ServeOptions): Promise<http.Server> {
  const server = http.createServer(createHandler(opts));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, opts.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
