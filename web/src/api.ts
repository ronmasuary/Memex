export interface NoteSummary {
  id: string;
  title: string;
  project: string;
  tags: string[];
  status: "active" | "conflict";
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
  status: "active" | "conflict";
  backlinks: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
}

export const fetchGraph = () => getJson<GraphData>("/api/graph");
export const fetchNotes =() => getJson<{ notes: NoteSummary[] }>("/api/notes");
export const fetchNote = (id: string) => getJson<NoteDetail>(`/api/note/${encodeURIComponent(id)}`);
