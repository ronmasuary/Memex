import MiniSearch from "minisearch";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { buildBacklinks, extractWikilinks } from "./links.js";
import { atomicWriteFile, type Note, type Vault } from "./vault.js";

const INDEX_VERSION = 2;
const EXCERPT_CHARS = 2000;
const SNIPPET_CHARS = 200;
export const DEFAULT_LIMIT = 8;

const OPTIONS = {
  idField: "path",
  fields: ["title", "tags", "key", "body"],
  storeFields: ["path", "id", "title", "project", "excerpt"],
};

interface Entry {
  id: string;
  mtimeMs: number;
  size: number;
  hash: string;
  links: string[];
  /** Archived notes are tracked (so sync stays cheap) but kept out of the search index and backlinks. */
  archived?: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  project: string;
  path: string;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  project?: string;
  limit?: number;
}

export interface SyncStats {
  added: number;
  updated: number;
  removed: number;
  /** Files actually re-parsed (mtime/size changed). */
  parsed: number;
}

function toDoc(note: Note) {
  return {
    path: note.path,
    id: note.id,
    title: note.title,
    project: note.project,
    tags: note.tags.join(" "),
    key: note.key ?? "",
    body: note.body,
    excerpt: note.body.slice(0, EXCERPT_CHARS),
  };
}

function makeSnippet(excerpt: string, terms: string[]): string {
  const flat = excerpt.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const positions = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 60) : 0;
  const slice = flat.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${slice}${start + SNIPPET_CHARS < flat.length ? "…" : ""}`;
}

/** MiniSearch projection of the vault. Rebuildable from markdown; persisted to `<vault>/.memex/index.json`. */
export class SearchIndex {
  private mini = new MiniSearch(OPTIONS);
  private entries = new Map<string, Entry>();
  private loaded = false;

  constructor(private readonly vault: Vault) {}

  get indexFile(): string {
    return path.join(this.vault.root, ".memex", "index.json");
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.indexFile, "utf8")) as {
        version: number;
        entries: [string, Entry][];
        index: unknown;
      };
      if (saved.version !== INDEX_VERSION) return;
      this.mini = MiniSearch.loadJSON(JSON.stringify(saved.index), OPTIONS);
      this.entries = new Map(saved.entries);
    } catch {
      // Missing or corrupt index: start empty; the next sync rebuilds it from markdown.
      this.mini = new MiniSearch(OPTIONS);
      this.entries = new Map();
    }
  }

  private async persist(): Promise<void> {
    const payload = { version: INDEX_VERSION, entries: [...this.entries], index: this.mini.toJSON() };
    await atomicWriteFile(this.indexFile, JSON.stringify(payload));
  }

  /** Drop the persisted index and rebuild everything from the markdown files. */
  async rebuild(): Promise<SyncStats> {
    await rm(this.indexFile, { force: true });
    this.mini = new MiniSearch(OPTIONS);
    this.entries = new Map();
    this.loaded = true;
    return this.sync();
  }

  /** mtime staleness sweep: re-parse only new or changed files, forget deleted ones. No watcher. */
  async sync(): Promise<SyncStats> {
    await this.load();
    const stats: SyncStats = { added: 0, updated: 0, removed: 0, parsed: 0 };
    const paths = await this.vault.listNotePaths();
    const present = new Set(paths);

    for (const rel of paths) {
      const info = await stat(this.vault.abs(rel));
      const entry = this.entries.get(rel);
      if (entry && entry.mtimeMs === info.mtimeMs && entry.size === info.size) continue;
      const note = await this.vault.readNote(rel);
      stats.parsed++;
      if (entry && entry.hash === note.hash) {
        // Touched but identical once line endings are normalized: nothing to re-index.
        this.entries.set(rel, { ...entry, mtimeMs: info.mtimeMs, size: info.size });
        continue;
      }
      // Archived notes are excluded from search (and contribute no backlinks); if one was indexed, drop it.
      const archived = note.status === "archived";
      if (entry && !entry.archived) {
        this.mini.discard(rel);
        stats.updated++;
      } else if (!entry) {
        stats.added++;
      } else {
        stats.updated++;
      }
      if (!archived) this.mini.add(toDoc(note));
      this.entries.set(rel, {
        id: note.id,
        mtimeMs: info.mtimeMs,
        size: info.size,
        hash: note.hash,
        links: archived ? [] : extractWikilinks(note.body),
        archived,
      });
    }

    for (const [rel, entry] of [...this.entries]) {
      if (present.has(rel)) continue;
      if (!entry.archived) this.mini.discard(rel); // archived entries were never added to the index
      this.entries.delete(rel);
      stats.removed++;
    }

    if (stats.added || stats.updated || stats.removed || stats.parsed) await this.persist();
    return stats;
  }

  /** Sweep, then query. Boosts title/tags/key over body; prefix + light fuzzy matching. */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    await this.sync();
    if (!query.trim()) return [];
    const results = this.mini.search(query, {
      boost: { title: 3, tags: 2, key: 2 },
      prefix: true,
      fuzzy: 0.2,
      filter: opts.project ? (r) => r.project === opts.project : undefined,
    });
    return results.slice(0, opts.limit ?? DEFAULT_LIMIT).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      project: r.project as string,
      path: r.path as string,
      score: r.score,
      snippet: makeSnippet(r.excerpt as string, r.terms),
    }));
  }

  /** Ids of notes that link to `id`. */
  async backlinks(id: string): Promise<string[]> {
    await this.sync();
    const sources = [...this.entries.values()].map((e) => ({ id: e.id, links: e.links }));
    return buildBacklinks(sources).get(id) ?? [];
  }

  get size(): number {
    return this.entries.size;
  }
}
