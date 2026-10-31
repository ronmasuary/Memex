import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { fetchGraph, fetchNote, fetchNotes, type NoteDetail, type NoteSummary } from "./api";
import { Graph } from "./Graph";

/** Tiny history-API router: three screens (list, graph, note), no library. */
function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return [path, go];
}

/** Resource state keyed by `key`, so a stale response never overwrites a newer one. */
function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ key, data }),
      (e: Error) => live && setState({ key, error: e.message }),
    );
    return () => {
      live = false;
    };
    // `load` is recreated every render; `key` identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { key, data: undefined, error: undefined };
}

const muted = "text-zinc-500 dark:text-zinc-400";
const panel = "rounded-lg border border-zinc-200 dark:border-zinc-800";

type LinkProps = (to: string) => { href: string; onClick: (e: MouseEvent) => void };

export function App() {
  const [path, go] = usePath();
  const noteId = path.startsWith("/note/") ? decodeURIComponent(path.slice("/note/".length)) : null;

  const link: LinkProps = (to) => ({
    href: to,
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(to);
    },
  });

  const isGraph = path === "/graph";
  const tab = (to: string, label: string, active: boolean) => (
    <a
      {...link(to)}
      aria-current={active ? "page" : undefined}
      className={active ? "font-medium underline underline-offset-4" : muted}
    >
      {label}
    </a>
  );

  return (
    <div className={`mx-auto px-4 py-6 ${isGraph ? "max-w-5xl" : "max-w-3xl"}`}>
      <header className="mb-6 flex items-baseline gap-6">
        <a {...link("/")} className="text-lg font-semibold tracking-tight">
          Memex
        </a>
        <nav className="flex gap-4 text-sm" aria-label="Views">
          {tab("/", "Notes", !isGraph && !noteId)}
          {tab("/graph", "Graph", isGraph)}
        </nav>
      </header>
      {noteId ? (
        <NoteView id={noteId} link={link} go={go} />
      ) : isGraph ? (
        <GraphView go={go} />
      ) : (
        <NoteList link={link} />
      )}
    </div>
  );
}

function GraphView({ go }: { go: (to: string) => void }) {
  const { data, error } = useAsync(fetchGraph, "graph");
  if (error) return <p className="text-red-600">Could not load graph: {error}</p>;
  if (!data) return <p className={muted}>Loading…</p>;
  return <Graph data={data} onOpen={(id) => go(`/note/${encodeURIComponent(id)}`)} />;
}

function NoteList({ link }: { link: LinkProps }) {
  const { data, error } = useAsync(fetchNotes, "notes");
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byProject = new Map<string, NoteSummary[]>();
    for (const n of data?.notes ?? []) {
      if (q && !`${n.title} ${n.id} ${n.project} ${n.tags.join(" ")}`.toLowerCase().includes(q)) continue;
      byProject.set(n.project, [...(byProject.get(n.project) ?? []), n]);
    }
    return [...byProject].sort(([a], [b]) => a.localeCompare(b));
  }, [data, filter]);

  if (error) return <p className="text-red-600">Could not load notes: {error}</p>;
  if (!data) return <p className={muted}>Loading…</p>;

  return (
    <>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by title, project or tag"
        aria-label="Filter notes"
        className={`${panel} mb-6 w-full bg-transparent px-3 py-2`}
      />
      {groups.length === 0 && (
        <p className={muted}>{data.notes.length ? "No notes match." : "This vault has no notes yet."}</p>
      )}
      {groups.map(([project, notes]) => (
        <section key={project} className="mb-6">
          <h2 className={`mb-2 text-sm font-medium uppercase tracking-wide ${muted}`}>
            {project} <span className="font-normal">({notes.length})</span>
          </h2>
          <ul className={`${panel} divide-y divide-zinc-200 dark:divide-zinc-800`}>
            {notes.map((n) => (
              <li key={n.id}>
                <a
                  {...link(`/note/${n.id}`)}
                  className="flex items-baseline justify-between gap-4 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span>
                    {n.title}
                    {n.status === "conflict" && (
                      <span className="ml-2 rounded bg-amber-200 px-1.5 text-xs text-amber-900">conflict</span>
                    )}
                  </span>
                  <span className={`shrink-0 text-xs ${muted}`}>{n.updated.slice(0, 10)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function NoteView({ id, link, go }: { id: string; link: LinkProps; go: (to: string) => void }) {
  const { data, error } = useAsync<NoteDetail>(() => fetchNote(id), id);

  // Rendered HTML carries plain <a class="wikilink" href="/note/x">; intercept to navigate without a reload.
  const onBodyClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (a.classList.contains("missing")) return e.preventDefault();
    if (a.classList.contains("wikilink")) {
      e.preventDefault();
      go(a.getAttribute("href") ?? "/");
    }
  };

  if (error) {
    return (
      <p className="text-red-600">
        {error}.{" "}
        <a {...link("/")} className="underline">
          Back to notes
        </a>
      </p>
    );
  }
  if (!data) return <p className={muted}>Loading…</p>;

  const { note, provenance, backlinks } = data;
  return (
    <article>
      <p className={`mb-1 text-sm ${muted}`}>
        <a {...link("/")} className="underline">
          Notes
        </a>{" "}
        / {note.project}
      </p>
      <h1 className="mb-3 text-2xl font-semibold">{note.title}</h1>
      <div className={`${panel} mb-6 flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-sm`} aria-label="Provenance">
        <span>
          <span className={muted}>source</span> {provenance.source ?? "unknown"}
        </span>
        {provenance.session && (
          <span>
            <span className={muted}>session</span> {provenance.session}
          </span>
        )}
        <span>
          <span className={muted}>updated</span> {provenance.updated.slice(0, 10)}
        </span>
        {provenance.why && (
          <span className="basis-full">
            <span className={muted}>why</span> {provenance.why}
          </span>
        )}
      </div>
      {note.status === "conflict" && (
        <p className="mb-4 rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
          This note is flagged as conflicting with another.
        </p>
      )}
      <div className="md" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: data.html }} />
      <aside className="mt-10">
        <h2 className={`mb-2 text-sm font-medium uppercase tracking-wide ${muted}`}>Backlinks ({backlinks.length})</h2>
        {backlinks.length === 0 ? (
          <p className={`text-sm ${muted}`}>No notes link here.</p>
        ) : (
          <ul className="list-disc pl-5">
            {backlinks.map((b) => (
              <li key={b.id}>
                <a {...link(`/note/${b.id}`)} className="text-blue-600 underline dark:text-blue-400">
                  {b.title}
                </a>
                <span className={`ml-2 text-xs ${muted}`}>{b.project}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </article>
  );
}
