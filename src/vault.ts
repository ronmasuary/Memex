import matter from "gray-matter";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gitFor, Queue, type CommitAuthor } from "./git.js";
import { findConflictPairs, type ConflictNote } from "./conflicts.js";
import { assertSafeFilename, makeSlug, slugify, uniqueSlug } from "./slug.js";

export const DEFAULT_PROJECT = "general";

/**
 * `conflict`: flagged as contradicting another note. `superseded`: lost a resolution; kept for history, ignored
 * by detection. `archived`: hidden from the default list, graph and search, and ignored by detection — but never
 * deleted; the note stays on disk and in git history and can be restored to `active`.
 */
export type NoteStatus = "active" | "conflict" | "superseded" | "archived";

/** Who wrote a note and why. Recorded in frontmatter and in the git commit. */
export interface Provenance {
  source: string;
  session?: string;
  why?: string;
}

export interface Note {
  id: string;
  title: string;
  project: string;
  tags: string[];
  key?: string;
  status: NoteStatus;
  source?: string;
  session?: string;
  why?: string;
  created: string;
  updated: string;
  body: string;
  /** POSIX path relative to the vault root, e.g. `memex/storage-decision.md`. */
  path: string;
  /** sha256 of the normalized (LF, no BOM) file text. */
  hash: string;
}

export interface NoteInput {
  title: string;
  body: string;
  project?: string;
  tags?: string[];
  /** A string sets the key; `null` clears an existing key; `undefined` leaves it unchanged on update. */
  key?: string | null;
  status?: NoteStatus;
}

export type ResolveAction = "keep_a" | "keep_b" | "keep_both";

export interface ResolveResult {
  action: ResolveAction;
  /** The note that was kept (keep_a / keep_b) or null for keep_both. */
  kept: string | null;
  /** The note that lost (keep_a / keep_b) or null for keep_both. */
  superseded: string | null;
  /** Id of the reconciliation note created by keep_both. */
  reconciliation: string | null;
  /** Paths touched by the single resolution commit. */
  files: string[];
  commit: string | null;
}

export interface WriteResult {
  note: Note;
  created: boolean;
  /** SHA of the provenance commit; null when the vault is not a git repo or `commit: false`. */
  commit: string | null;
}

/** Strip a BOM and convert CRLF / lone CR to LF. All parsing and hashing works on this form. */
export function normalizeText(text: string): string {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return stripped.replace(/\r\n?/g, "\n");
}

export function hashText(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

/** Write via a temp file in the same directory, then rename over the target. */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (err) {
        // Windows can transiently refuse a rename over a file that something (AV, indexer) has open.
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function toIso(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Parse note text. The id always comes from the filename so it can never disagree with the path. */
export function parseNote(relPath: string, rawText: string): Note {
  const text = normalizeText(rawText);
  // Passing options bypasses gray-matter's global cache, which hands out shared mutable objects.
  const parsed = matter(text, {});
  const data = parsed.data as Record<string, unknown>;
  const id = path.posix.basename(relPath, ".md");
  const epoch = new Date(0).toISOString();
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  return {
    id,
    title: optionalString(data.title) ?? id,
    project: optionalString(data.project) ?? path.posix.dirname(relPath),
    tags,
    key: optionalString(data.key),
    status:
      data.status === "conflict" || data.status === "superseded" || data.status === "archived"
        ? data.status
        : "active",
    source: optionalString(data.source),
    session: optionalString(data.session),
    why: optionalString(data.why),
    created: toIso(data.created, epoch),
    updated: toIso(data.updated, epoch),
    body: parsed.content.trim(),
    path: relPath,
    hash: hashText(text),
  };
}

/** Serialize a note to its on-disk form (LF, frontmatter in the plan's key order). */
export function serializeNote(note: Omit<Note, "path" | "hash">): string {
  const data: Record<string, unknown> = { id: note.id, title: note.title, project: note.project, tags: note.tags };
  for (const field of ["key", "status", "source", "session", "why"] as const) {
    if (note[field] !== undefined) data[field] = note[field];
  }
  data.created = note.created;
  data.updated = note.updated;
  return normalizeText(matter.stringify(`${note.body.trim()}\n`, data));
}

export function commitMessage(id: string, created: boolean, prov: Provenance): string {
  const lines = [`memex: ${created ? "add" : "update"} ${id}`, "", `note: ${id}`];
  if (prov.why) lines.push(`why: ${prov.why}`);
  lines.push(`source: ${prov.source}`);
  if (prov.session) lines.push(`session: ${prov.session}`);
  return lines.join("\n");
}

/** Commit subject/body for a status flip (archive / restore) that keeps the note and its history intact. */
function statusCommitMessage(verb: "archive" | "restore", id: string, prov: Provenance): string {
  const lines = [`memex: ${verb} ${id}`, "", `note: ${id}`];
  if (prov.why) lines.push(`why: ${prov.why}`);
  lines.push(`source: ${prov.source}`);
  if (prov.session) lines.push(`session: ${prov.session}`);
  return lines.join("\n");
}

function safeSlug(title: string): string | undefined {
  try {
    return makeSlug(title);
  } catch {
    return undefined;
  }
}

export class Vault {
  readonly root: string;
  private readonly writes = new Queue();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Absolute path for a POSIX vault-relative path. Conversion to native separators happens only here. */
  abs(relPath: string): string {
    return path.join(this.root, ...relPath.split("/"));
  }

  /** POSIX relative paths of every note: `<project>/<slug>.md`, two levels max, dot-dirs ignored. */
  async listNotePaths(): Promise<string[]> {
    const result: string[] = [];
    const top = await readdir(this.root, { withFileTypes: true });
    for (const dir of top) {
      if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
      const entries = await readdir(path.join(this.root, dir.name), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) result.push(`${dir.name}/${entry.name}`);
      }
    }
    return result.sort();
  }

  async readNote(relPath: string): Promise<Note> {
    try {
      return parseNote(relPath, await readFile(this.abs(relPath), "utf8"));
    } catch (err) {
      throw new Error(`failed to read note ${relPath}: ${(err as Error).message}`, { cause: err });
    }
  }

  async findById(id: string): Promise<Note | undefined> {
    const rel = (await this.listNotePaths()).find((p) => path.posix.basename(p, ".md") === id);
    return rel ? this.readNote(rel) : undefined;
  }

  /**
   * Create or update a note and (in a git vault) record it as exactly one commit.
   * A title that slugifies to an existing note in the same project updates that note;
   * a slug already used by a different note (other project) gets a `-2`, `-3`, ... suffix.
   */
  writeNote(input: NoteInput, prov: Provenance, opts: { commit?: boolean } = {}): Promise<WriteResult> {
    return this.writes.run(() => this.doWrite(input, prov, opts.commit ?? true));
  }

  private async doWrite(input: NoteInput, prov: Provenance, commit: boolean): Promise<WriteResult> {
    const title = input.title.trim();
    const slug = makeSlug(title);
    const project = makeSlug(input.project ?? DEFAULT_PROJECT);

    // Ids are unique across the vault because wikilinks address notes by id alone.
    const existing = new Map<string, Note>();
    for (const rel of await this.listNotePaths()) {
      existing.set(path.posix.basename(rel, ".md"), await this.readNote(rel));
    }
    const isSameNote = (n: Note) => n.path.startsWith(`${project}/`) && safeSlug(n.title) === slug;
    const id = uniqueSlug(slug, (candidate) => {
      const other = existing.get(candidate);
      return other !== undefined && !isSameNote(other);
    });
    assertSafeFilename(`${id}.md`);

    const previous = existing.get(id);
    const now = new Date().toISOString();
    const note: Omit<Note, "path" | "hash"> = {
      id,
      title,
      project,
      tags: input.tags ?? previous?.tags ?? [],
      // `null` explicitly clears the key; `undefined` keeps whatever the note had.
      key: input.key === null ? undefined : (input.key ?? previous?.key),
      status: input.status ?? previous?.status ?? "active",
      source: prov.source,
      session: prov.session,
      why: prov.why,
      created: previous?.created ?? now,
      updated: now,
      body: input.body,
    };
    const relPath = `${project}/${id}.md`;
    const text = serializeNote(note);
    await atomicWriteFile(this.abs(relPath), text);

    const saved: Note = { ...note, body: note.body.trim(), path: relPath, hash: hashText(text) };
    let sha: string | null = null;
    if (commit && existsSync(path.join(this.root, ".git"))) {
      const author = { name: prov.source, email: `${slugify(prov.source) || "agent"}@memex.local` };
      sha = await gitFor(this.root).commit([relPath], commitMessage(id, !previous, prov), author);
    }
    return { note: saved, created: !previous, commit: sha };
  }

  /**
   * Archive a note as exactly ONE git commit: its status becomes `archived`. Memex never hard-deletes — the
   * file stays on disk and in git history, and the note can be restored with {@link unarchiveNote}. An archived
   * note drops out of the default list, the graph, search and contradiction detection.
   */
  archiveNote(id: string, prov: Provenance): Promise<WriteResult> {
    return this.writes.run(() => this.doSetArchived(id, true, prov));
  }

  /** Restore an archived note to `active` as exactly ONE git commit. */
  unarchiveNote(id: string, prov: Provenance): Promise<WriteResult> {
    return this.writes.run(() => this.doSetArchived(id, false, prov));
  }

  private async doSetArchived(id: string, archive: boolean, prov: Provenance): Promise<WriteResult> {
    const relPath = (await this.listNotePaths()).find((p) => path.posix.basename(p, ".md") === id);
    if (!relPath) throw new Error(`no note with id "${id}"`);
    const current = await this.readNote(relPath);
    if (archive && current.status === "archived") throw new Error(`"${id}" is already archived`);
    if (!archive && current.status !== "archived") throw new Error(`"${id}" is not archived`);

    const now = new Date().toISOString();
    const note: Omit<Note, "path" | "hash"> = {
      id: current.id,
      title: current.title,
      project: current.project,
      tags: current.tags,
      key: current.key,
      status: archive ? "archived" : "active",
      source: prov.source,
      session: prov.session,
      why: prov.why ?? current.why,
      created: current.created,
      updated: now,
      body: current.body,
    };
    const text = serializeNote(note);
    await atomicWriteFile(this.abs(relPath), text);

    const saved: Note = { ...note, body: note.body.trim(), path: relPath, hash: hashText(text) };
    let sha: string | null = null;
    if (existsSync(path.join(this.root, ".git"))) {
      const author = { name: prov.source, email: `${slugify(prov.source) || "agent"}@memex.local` };
      sha = await gitFor(this.root).commit([relPath], statusCommitMessage(archive ? "archive" : "restore", id, prov), author);
    }
    return { note: saved, created: false, commit: sha };
  }

  /**
   * Resolve one detected contradiction between notes `aId` and `bId` as exactly ONE git commit.
   *
   * - keep_a / keep_b: the kept note returns to `active` and gains `Supersedes: [[loser]]`; the loser becomes
   *   `status: superseded` (kept for history, never deleted) and gains `Superseded by: [[kept]]`.
   * - keep_both: both return to `active`, each gains `Reconciled with: [[other]]` (which silences the detector for
   *   the pair), and a new reconciliation note linking both is created from `note` (required).
   *
   * Refuses when the two notes are not currently in conflict, so a stale click or a retried tool call can't rewrite history.
   */
  resolveConflict(aId: string, bId: string, action: ResolveAction, prov: Provenance, note?: string): Promise<ResolveResult> {
    return this.writes.run(() => this.doResolve(aId, bId, action, prov, note));
  }

  private async doResolve(aId: string, bId: string, action: ResolveAction, prov: Provenance, note?: string): Promise<ResolveResult> {
    if (aId === bId) throw new Error("a and b must be two different notes");
    const all = await Promise.all((await this.listNotePaths()).map((p) => this.readNote(p)));
    const a = all.find((n) => n.id === aId);
    const b = all.find((n) => n.id === bId);
    if (!a) throw new Error(`no note with id "${aId}"`);
    if (!b) throw new Error(`no note with id "${bId}"`);
    const toConflictNote = (n: Note): ConflictNote => ({ id: n.id, title: n.title, key: n.key, project: n.project, status: n.status, body: n.body, updated: n.updated });
    const inConflict = findConflictPairs(all.map(toConflictNote)).some(
      (p) => (p.a.id === aId && p.b.id === bId) || (p.a.id === bId && p.b.id === aId),
    );
    if (!inConflict) throw new Error(`"${aId}" and "${bId}" are not in conflict (already resolved, or never contradicted)`);
    if (action === "keep_both" && !note?.trim()) throw new Error("keep_both needs a reconciliation note explaining how the two fit together");

    const now = new Date().toISOString();
    const touched: Omit<Note, "path" | "hash">[] = [];
    const stamp = (n: Note, changes: Partial<Note>): void => {
      touched.push({ ...n, ...changes, source: prov.source, session: prov.session, why: prov.why ?? n.why, updated: now });
    };
    let kept: Note | undefined;
    let lost: Note | undefined;
    let reconciliation: string | null = null;

    if (action === "keep_both") {
      stamp(a, { status: "active", body: withLine(a.body, `Reconciled with: [[${b.id}]]`) });
      stamp(b, { status: "active", body: withLine(b.body, `Reconciled with: [[${a.id}]]`) });
      const title = `Reconciliation: ${a.key ?? `${a.id} and ${b.id}`}`;
      const slug = makeSlug(title);
      const taken = new Set(all.map((n) => n.id));
      const id = uniqueSlug(slug, (candidate) => taken.has(candidate));
      reconciliation = id;
      touched.push({
        id, title, project: a.project, tags: ["reconciliation"], status: "active",
        source: prov.source, session: prov.session, why: prov.why, created: now, updated: now,
        body: `Reconciles [[${a.id}]] and [[${b.id}]].

${note!.trim()}`,
      });
    } else {
      kept = action === "keep_a" ? a : b;
      lost = action === "keep_a" ? b : a;
      stamp(kept, { status: "active", body: withLine(kept.body, `Supersedes: [[${lost.id}]]`) });
      stamp(lost, { status: "superseded", body: withLine(lost.body, `Superseded by: [[${kept.id}]]`) });
    }

    const files: string[] = [];
    for (const n of touched) {
      const relPath = `${n.project}/${n.id}.md`;
      await atomicWriteFile(this.abs(relPath), serializeNote(n));
      files.push(relPath);
    }
    let sha: string | null = null;
    if (existsSync(path.join(this.root, ".git"))) {
      const lines = [
        `memex: resolve conflict ${a.id} / ${b.id} (${action.replace("_", " ")})`,
        "",
        `notes: ${files.map((f) => path.posix.basename(f, ".md")).join(", ")}`,
      ];
      if (prov.why) lines.push(`why: ${prov.why}`);
      lines.push(`source: ${prov.source}`);
      if (prov.session) lines.push(`session: ${prov.session}`);
      const author = { name: prov.source, email: `${slugify(prov.source) || "agent"}@memex.local` };
      sha = await gitFor(this.root).commit(files, lines.join("\n"), author);
    }
    return { action, kept: kept?.id ?? null, superseded: lost?.id ?? null, reconciliation, files, commit: sha };
  }
}

/** Append `line` to a body unless it is already present as a line of its own (resolutions stay idempotent). */
function withLine(body: string, line: string): string {
  return body.split("\n").some((l) => l.trim() === line) ? body : `${body.trimEnd()}\n\n${line}`;
}

const SEED_BODY = `Memex stores one note per markdown file and records every write as a git commit.

- Link notes with wikilinks, e.g. [[welcome-to-memex]].
- Find notes with \`memex find <query>\`.
- Every note carries \`source\`, \`session\` and \`why\` so you can tell who wrote it.
`;

export interface InitOptions {
  remote?: string;
  /** Pin this committer identity to the new vault's local git config so it authors the initial commit. */
  identity?: CommitAuthor;
}

/** Scaffold a vault: git repo, `.gitattributes`, `.gitignore`, `memex.json`, a seed note, one initial commit. */
export async function initVault(dir: string, opts: InitOptions = {}): Promise<Vault> {
  const vault = new Vault(dir);
  if (existsSync(path.join(vault.root, "memex.json"))) {
    throw new Error(`${vault.root} is already a Memex vault`);
  }
  await mkdir(vault.root, { recursive: true });
  const git = gitFor(vault.root);
  await git.init(opts.identity);
  await atomicWriteFile(path.join(vault.root, ".gitattributes"), "* text=auto eol=lf\n");
  await atomicWriteFile(path.join(vault.root, ".gitignore"), ".memex/\n");
  await atomicWriteFile(
    path.join(vault.root, "memex.json"),
    `${JSON.stringify({ version: 1, name: path.basename(vault.root) }, null, 2)}\n`,
  );
  await vault.writeNote(
    { title: "Welcome to Memex", body: SEED_BODY, project: "memex", tags: ["seed"] },
    { source: "memex/init", why: "seed note created by memex init" },
    { commit: false },
  );
  if (opts.remote) await git.addRemote("origin", opts.remote);
  await git.commitAll("chore: initialize memex vault");
  return vault;
}
