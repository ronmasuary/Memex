import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveNote, fetchConflicts, fetchGraph, fetchNote, fetchNotes, unarchiveNote,
  type ConflictsData, type GraphData, type NoteDetail, type NoteSummary,
} from "./api";
import { projectColors } from "./colors";
import { ConflictsView } from "./Conflicts";
import { Editor } from "./Editor";
import { Graph } from "./Graph";
import { Icon, IconSprite } from "./icons";
import { NoteDrawer } from "./NoteDrawer";

type Tab = "notes" | "graph" | "conflicts";
const TAB_PATH: Record<Tab, string> = { notes: "/", graph: "/graph", conflicts: "/conflicts" };

/** Tiny history-API router: the three tabs plus /note/:id (which opens the drawer over the current tab). */
function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (to: string) => {
    if (to === window.location.pathname) return setPath(to);
    window.history.pushState(null, "", to);
    setPath(to);
  };
  return [path, go];
}

export function App() {
  const [path, go] = usePath();
  const noteId = path.startsWith("/note/") ? decodeURIComponent(path.slice("/note/".length)) : null;

  const lastTab = useRef<Tab>("notes");
  let tab: Tab;
  if (noteId) tab = lastTab.current;
  else {
    tab = path === "/graph" ? "graph" : path === "/conflicts" ? "conflicts" : "notes";
    lastTab.current = tab;
  }

  // data (refetched on `rev`); previous data is kept visible while a refresh is in flight.
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((r) => r + 1), []);
  const [notes, setNotes] = useState<NoteSummary[]>();
  const [graph, setGraph] = useState<GraphData>();
  const [conflicts, setConflicts] = useState<ConflictsData>();
  // Per-tab load errors: the three fetches are independent, so one failing (e.g. the graph) must not
  // blank the other tabs. On a refresh, a now-failing fetch keeps its last-good data on screen.
  const [errors, setErrors] = useState<{ notes?: string; graph?: string; conflicts?: string }>({});
  useEffect(() => {
    let live = true;
    const reason = (r: unknown) => (r instanceof Error ? r.message : String(r));
    Promise.allSettled([fetchNotes(), fetchGraph(), fetchConflicts()]).then(([n, g, c]) => {
      if (!live) return;
      const next: { notes?: string; graph?: string; conflicts?: string } = {};
      if (n.status === "fulfilled") setNotes(n.value.notes); else next.notes = reason(n.reason);
      if (g.status === "fulfilled") setGraph(g.value); else next.graph = reason(g.reason);
      if (c.status === "fulfilled") setConflicts(c.value); else next.conflicts = reason(c.reason);
      setErrors(next);
    });
    return () => { live = false; };
  }, [rev]);

  const projects = useMemo(() => (notes ?? []).map((n) => n.project), [notes]);
  const color = useMemo(() => projectColors(projects), [projects]);

  // toast
  const [toast, setToast] = useState<{ msg: string; id: number }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = useCallback((msg: string) => {
    setToast({ msg, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 2600);
  }, []);

  // editor
  const [editor, setEditor] = useState<{ open: boolean; initial: NoteDetail | null }>({ open: false, initial: null });
  const openNew = () => setEditor({ open: true, initial: null });
  const openEditDetail = (detail: NoteDetail) => setEditor({ open: true, initial: detail });
  const openEditId = async (id: string) => {
    try { setEditor({ open: true, initial: await fetchNote(id) }); }
    catch (e) { say((e as Error).message); }
  };
  const closeEditor = () => setEditor((s) => ({ ...s, open: false }));

  const openNote = (id: string) => go(`/note/${encodeURIComponent(id)}`);
  const closeNote = () => go(TAB_PATH[lastTab.current]);

  const doArchive = async (id: string) => {
    try { await archiveNote(id); say("Archived · still in git history"); if (noteId === id) closeNote(); refresh(); }
    catch (e) { say((e as Error).message); }
  };
  const doRestore = async (id: string) => {
    try { await unarchiveNote(id); say("Restored from archive"); refresh(); }
    catch (e) { say((e as Error).message); }
  };

  // global search query (shared by the header field and the notes list)
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const onHeaderSearch = (v: string) => { setQuery(v); if (tab !== "notes") go("/"); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { if (editor.open) closeEditor(); else if (noteId) closeNote(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.open, noteId]);

  const conflictCount = conflicts?.conflicts.length ?? 0;
  const tabBtn = (t: Tab, label: string, icon: Parameters<typeof Icon>[0]["name"], badge?: number) => (
    <button role="tab" aria-selected={tab === t} onClick={() => go(TAB_PATH[t])}>
      <Icon name={icon} />{label}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <>
      <IconSprite />
      <header>
        <div className="bar gutter view">
          <button className="brand" onClick={() => go("/")}><span className="dot" />Memex</button>
          <div className="tabs" role="tablist">
            {tabBtn("graph", "Graph", "graph")}
            {tabBtn("notes", "Notes", "list")}
            {tabBtn("conflicts", "Conflicts", "alert", conflictCount || undefined)}
          </div>
          <div className="right">
            <div className="search">
              <Icon name="search" style={{ color: "var(--fg-faint)" }} />
              <input ref={searchRef} value={query} onChange={(e) => onHeaderSearch(e.target.value)} placeholder="Search the vault" aria-label="Search the vault" />
              <kbd>⌘K</kbd>
            </div>
            <button className="btn primary" onClick={openNew}><Icon name="plus" /><span className="lbl-txt">New note</span></button>
          </div>
        </div>
      </header>

      <main className="gutter">
        {tab === "graph" && (
          <section className="view">
            {graph
              ? <Graph data={graph} onOpen={openNote} />
              : errors.graph
                ? <p className="banner err">Could not load the graph: {errors.graph}</p>
                : <p className="loading view">Loading…</p>}
          </section>
        )}

        {tab === "notes" && (
          <NotesView
            notes={notes} error={errors.notes} color={color} query={query} setQuery={setQuery}
            onOpen={openNote} onEdit={openEditId} onArchive={doArchive} onRestore={doRestore} onNew={openNew}
          />
        )}

        {tab === "conflicts" && (
          conflicts
            ? <ConflictsView data={conflicts} color={color} onResolved={refresh} onOpenNote={openNote} />
            : errors.conflicts
              ? <div className="view"><p className="banner err">Could not load conflicts: {errors.conflicts}</p></div>
              : <p className="loading view">Loading…</p>
        )}
      </main>

      <NoteDrawer
        id={noteId} color={color} onClose={closeNote} onOpenNote={openNote}
        onEdit={openEditDetail} onArchive={doArchive} onRestore={doRestore} onGoConflicts={() => { closeNote(); go("/conflicts"); }}
      />
      <Editor
        open={editor.open} initial={editor.initial} projects={[...new Set(projects)]}
        onClose={closeEditor} onSaved={(msg) => { say(msg); refresh(); }}
      />
      {toast && <div className="toast" key={toast.id}><span className="dot" />{toast.msg}</div>}
    </>
  );
}

function NotesView({
  notes, error, color, query, setQuery, onOpen, onEdit, onArchive, onRestore, onNew,
}: {
  notes: NoteSummary[] | undefined;
  error?: string;
  color: Map<string, string>;
  query: string;
  setQuery: (v: string) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onNew: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byProject = new Map<string, NoteSummary[]>();
    for (const n of notes ?? []) {
      if (showArchived ? n.status !== "archived" : n.status === "archived") continue;
      if (q && !`${n.title} ${n.id} ${n.project} ${n.tags.join(" ")}`.toLowerCase().includes(q)) continue;
      byProject.set(n.project, [...(byProject.get(n.project) ?? []), n]);
    }
    return [...byProject].sort(([a], [b]) => a.localeCompare(b));
  }, [notes, query, showArchived]);

  const statusTag = (s: NoteSummary["status"]) =>
    s === "conflict" ? <span className="statustag st-conflict">conflict</span>
      : s === "superseded" ? <span className="statustag st-superseded">superseded</span>
        : s === "archived" ? <span className="statustag st-archived">archived</span>
          : null;

  return (
    <div className="view">
      <div className="listhead">
        <div className="bigsearch">
          <Icon name="search" style={{ color: "var(--fg-faint)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by title, id, project or tag" aria-label="Filter notes" />
        </div>
        <button className="toggle" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
          <span className="switch" />Show archived
        </button>
        <button className="btn primary" onClick={onNew}><Icon name="plus" />New note</button>
      </div>

      {!notes && error && <p className="banner err">Could not load notes: {error}</p>}
      {!notes && !error && <p className="loading">Loading…</p>}
      {notes && groups.length === 0 && (
        <p className="empty">
          {showArchived
            ? "No archived notes. Archiving keeps a note in git history; nothing is ever hard-deleted."
            : query.trim()
              ? "No notes match."
              : notes.length === 0
                ? "This vault has no notes yet."
                : "Every note here is archived. Toggle “Show archived” to see them."}
        </p>
      )}

      {groups.map(([project, list]) => (
        <div className="proj-group" key={project}>
          <h2>
            <span className="sw" style={{ background: color.get(project) }} />
            {project} <span className="ct">({list.length})</span>
          </h2>
          <div className="notelist">
            {list.map((n) => (
              <div className={`noteitem${n.status === "archived" ? " arch" : ""}`} key={n.id}>
                <button className="ttl" onClick={() => onOpen(n.id)}>
                  {n.title}
                  {n.tags.length > 0 && <div className="sub">#{n.tags.join("  #")}</div>}
                </button>
                {statusTag(n.status)}
                <span className="datecol">{n.updated.slice(0, 10)}</span>
                <div className="rowact">
                  <button title="Edit" aria-label={`Edit ${n.title}`} onClick={() => onEdit(n.id)}><Icon name="pencil" /></button>
                  {n.status === "archived"
                    ? <button title="Restore from archive" aria-label={`Restore ${n.title}`} onClick={() => onRestore(n.id)}><Icon name="restore" /></button>
                    : <button title="Archive (kept in git history)" aria-label={`Archive ${n.title}`} onClick={() => onArchive(n.id)}><Icon name="archive" /></button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
