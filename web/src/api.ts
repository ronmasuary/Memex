export type NoteStatus = "active" | "conflict" | "superseded" | "archived";

export interface NoteSummary {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: NoteStatus;
  updated: string;
}

export interface NoteDetail {
  note: NoteSummary & { key: string | null; created: string; body: string };
  html: string;
  provenance: { source?: string; session?: string; why?: string; created: string; updated: string };
  backlinks: { id: string; title: string; project: string }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

/** Shared POST helper for the loopback-gated write routes. */
async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export interface GraphNode {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: NoteStatus;
  backlinks: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
}

export const fetchGraph = () => getJson<GraphData>("/api/graph");
/** Includes archived notes so the client can toggle the Archived view without a second request. */
export const fetchNotes = () => getJson<{ notes: NoteSummary[] }>("/api/notes?includeArchived=1");
export const fetchNote = (id: string) => getJson<NoteDetail>(`/api/note/${encodeURIComponent(id)}`);

export interface ConflictSide {
  id: string;
  title: string;
  project: string;
  status: NoteStatus;
  updated: string;
  key: string | null;
  body: string;
  provenance: { source?: string; session?: string; why?: string; created: string; updated: string };
}

export interface ConflictPair {
  id: string;
  key: string;
  project: string;
  /** The older note. */
  a: ConflictSide;
  /** The newer note, the write that collided. */
  b: ConflictSide;
  aValues: string[];
  bValues: string[];
}

export interface ConflictsData {
  conflicts: ConflictPair[];
  /** Notes marked `status: conflict` that no detected pair accounts for. */
  flagged: { id: string; title: string; project: string; key: string | null }[];
}

export type ResolveAction = "keep_a" | "keep_b" | "keep_both";

export const fetchConflicts = () => getJson<ConflictsData>("/api/conflicts");

/** POST /api/conflicts/resolve (loopback-gated). One git commit per call; nothing is deleted. */
export const resolveConflict = (a: string, b: string, action: ResolveAction, note?: string) =>
  postJson<{ commit: string | null; kept: string | null; superseded: string | null; reconciliation: string | null }>(
    "/api/conflicts/resolve",
    { a, b, action, note },
  );

/** A contradiction warning returned when a saved note collides on its key with an existing active note. */
export interface ContradictionWarning {
  id: string;
  title?: string;
  key: string;
  existingValues: string[];
  candidateValues: string[];
  message: string;
}

export interface NoteInput {
  title: string;
  body: string;
  project?: string;
  tags?: string[];
  key?: string | null;
  why?: string;
}

export interface WriteNoteResult {
  note: NoteSummary & { key: string | null; created: string; body: string };
  created: boolean;
  commit: string | null;
  warnings: ContradictionWarning[];
}

/** Create or update a note (one commit). Returns the saved note and any contradiction warnings. */
export const writeNote = (input: NoteInput) => postJson<WriteNoteResult>("/api/notes", input);

/** Archive a note (one commit). Memex never hard-deletes; the note stays in git history. */
export const archiveNote = (id: string) =>
  postJson<{ note: NoteSummary & { key: string | null }; commit: string | null }>("/api/notes/archive", { id });

/** Restore an archived note to active (one commit). */
export const unarchiveNote = (id: string) =>
  postJson<{ note: NoteSummary & { key: string | null }; commit: string | null }>("/api/notes/unarchive", { id });
