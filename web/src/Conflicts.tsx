import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { fetchConflicts, resolveConflict, type ConflictPair, type ConflictSide, type ConflictsData, type ResolveAction } from "./api";

const muted = "text-zinc-500 dark:text-zinc-400";
const panel = "rounded-lg border border-zinc-200 dark:border-zinc-800";
const button =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

type Link = (to: string) => { href: string; onClick: (e: MouseEvent) => void };

function Side({ label, side, values, link }: { label: string; side: ConflictSide; values: string[]; link: Link }) {
  const p = side.provenance;
  return (
    <div className={`${panel} flex min-w-0 flex-col p-3`}>
      <p className={`mb-1 text-xs font-medium uppercase tracking-wide ${muted}`}>{label}</p>
      <a {...link(`/note/${side.id}`)} className="mb-2 font-medium underline underline-offset-4">
        {side.title}
      </a>
      <pre className="mb-3 flex-1 whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-sans text-sm dark:bg-zinc-900">{side.body}</pre>
      <p className="mb-1 text-xs">
        <span className={muted}>asserts only </span>
        {values.length === 0 ? (
          <span className={muted}>nothing distinct</span>
        ) : (
          values.map((v) => (
            <code key={v} className="mr-1 rounded bg-amber-200 px-1 text-amber-950 dark:bg-amber-900 dark:text-amber-100">
              {v.replace(/^`/, "")}
            </code>
          ))
        )}
      </p>
      <p className={`text-xs ${muted}`}>
        {p.source ?? "unknown"}
        {p.session ? ` · session ${p.session}` : ""} · {p.updated.slice(0, 16).replace("T", " ")}
        {p.why ? ` · why: ${p.why}` : ""}
      </p>
    </div>
  );
}

function Pair({ pair, link, onResolved }: { pair: ConflictPair; link: Link; onResolved: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reconciling, setReconciling] = useState(false);
  const [note, setNote] = useState("");

  const run = async (action: ResolveAction) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await resolveConflict(pair.a.id, pair.b.id, action, note);
      const what = action === "keep_both" ? "Kept both" : `Kept ${r.kept}`;
      onResolved(`${what}${r.commit ? ` (commit ${r.commit.slice(0, 7)})` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className={`${panel} mb-6 p-4`} aria-label={`Conflict on ${pair.key}`}>
      <h2 className="mb-3 text-sm">
        <span className={muted}>{pair.project} / key </span>
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{pair.key}</code>
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Side label="A - older" side={pair.a} values={pair.aValues} link={link} />
        <Side label="B - newer" side={pair.b} values={pair.bValues} link={link} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className={button} disabled={busy} onClick={() => run("keep_a")}>
          Keep A
        </button>
        <button className={button} disabled={busy} onClick={() => run("keep_b")}>
          Keep B
        </button>
        <button className={button} disabled={busy} aria-expanded={reconciling} onClick={() => setReconciling((v) => !v)}>
          Keep both…
        </button>
        <span className={`text-xs ${muted}`}>Each choice is one git commit; nothing is deleted.</span>
      </div>
      {reconciling && (
        <div className="mt-3">
          <label className="mb-1 block text-sm" htmlFor={`rec-${pair.id}`}>
            Reconciliation note: how can both be true?
          </label>
          <textarea
            id={`rec-${pair.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Postgres on the server, SQLite on laptops."
            className={`${panel} w-full bg-transparent px-3 py-2 text-sm`}
          />
          <button className={`${button} mt-2`} disabled={busy || !note.trim()} onClick={() => run("keep_both")}>
            Keep both with this note
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

/** The Conflicts inbox: every detected contradiction, side by side, with the three resolve actions. */
export function ConflictsView({ link, onCount }: { link: Link; onCount: (n: number) => void }) {
  const [data, setData] = useState<ConflictsData>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  const load = useCallback(() => {
    fetchConflicts().then(
      (d) => {
        setData(d);
        onCount(d.conflicts.length);
      },
      (e: Error) => setError(e.message),
    );
  }, [onCount]);
  useEffect(load, [load]);

  if (error) return <p className="text-red-600">Could not load conflicts: {error}</p>;
  if (!data) return <p className={muted}>Loading…</p>;

  return (
    <>
      {done && (
        <p role="status" className="mb-4 rounded bg-green-100 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
          Resolved. {done}
        </p>
      )}
      {data.conflicts.length === 0 && (
        <p className={muted}>No unresolved conflicts. When an agent saves a note that contradicts another, it lands here.</p>
      )}
      {data.conflicts.map((pair) => (
        <Pair
          key={pair.id}
          pair={pair}
          link={link}
          onResolved={(msg) => {
            setDone(msg);
            load();
          }}
        />
      ))}
      {data.flagged.length > 0 && (
        <section className="mt-8">
          <h2 className={`mb-2 text-sm font-medium uppercase tracking-wide ${muted}`}>Flagged by hand ({data.flagged.length})</h2>
          <p className={`mb-2 text-sm ${muted}`}>These carry status: conflict but have no detected counterpart; edit the file to clear the flag.</p>
          <ul className="list-disc pl-5">
            {data.flagged.map((f) => (
              <li key={f.id}>
                <a {...link(`/note/${f.id}`)} className="underline">
                  {f.title}
                </a>
                <span className={`ml-2 text-xs ${muted}`}>{f.project}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
