export interface NoteSummary {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: "active" | "conflict" | "superseded";
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

export interface GraphNode {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: "active" | "conflict" | "superseded";
  backlinks: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
}

export const fetchGraph = () => getJson<GraphData>("/api/graph");
export const fetchNotes = () => getJson<{ notes: NoteSummary[] }>("/api/notes");
export const fetchNote = (id: string) => getJson<NoteDetail>(`/api/note/${encodeURIComponent(id)}`);

export interface ConflictSide {
  id: string;
  title: string;
  project: string;
  status: "active" | "conflict" | "superseded";
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

/** The one write the UI makes: POST /api/conflicts/resolve (loopback-gated on the server). One git commit per call. */
export async function resolveConflict(a: string, b: string, action: ResolveAction, note?: string) {
  const res = await fetch("/api/conflicts/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a, b, action, note }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as { commit: string | null; kept: string | null; superseded: string | null; reconciliation: string | null };
}
