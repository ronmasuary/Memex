import { useState } from "react";
import { resolveConflict, type ConflictPair, type ConflictSide, type ConflictsData, type ResolveAction } from "./api";
import { Icon } from "./icons";

function provLine(p: ConflictSide["provenance"]): string {
  return [
    p.source ?? "unknown",
    p.session ? `session ${p.session}` : null,
    p.updated.slice(0, 16).replace("T", " "),
    p.why ? `why: ${p.why}` : null,
  ].filter(Boolean).join(" · ");
}

function Side({
  label, flag, side, values, color, onOpenNote,
}: {
  label: string; flag?: string; side: ConflictSide; values: string[];
  color: Map<string, string>; onOpenNote: (id: string) => void;
}) {
  return (
    <div className="side">
      <div className="lbl"><span>{label}</span>{flag && <span className="flag">{flag}</span>}</div>
      <div className="sttl"><button onClick={() => onOpenNote(side.id)}>{side.title}</button></div>
      <div className="cbody">{side.body.replace(/\*\*/g, "").replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, id, lbl) => lbl || id)}</div>
      <div className="asserts">
        <span style={{ color: "var(--fg-faint)" }}>asserts </span>
        {values.length === 0
          ? <span style={{ color: "var(--fg-faint)" }}>nothing distinct</span>
          : values.map((v) => <code key={v}>{v.replace(/^`/, "")}</code>)}
      </div>
      <div className="prov">
        <span className="sw" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color.get(side.project), marginRight: 6 }} />
        {provLine(side.provenance)}
      </div>
    </div>
  );
}

function Pair({
  pair, color, onResolved, onOpenNote,
}: {
  pair: ConflictPair; color: Map<string, string>; onResolved: (msg: string) => void; onOpenNote: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reconciling, setReconciling] = useState(false);
  const [note, setNote] = useState("");

  const run = async (action: ResolveAction) => {
    setBusy(true); setError(undefined);
    try {
      const r = await resolveConflict(pair.a.id, pair.b.id, action, note);
      const what = action === "keep_both" ? "Kept both" : `Kept ${r.kept}`;
      onResolved(`${what}${r.commit ? ` · commit ${r.commit.slice(0, 7)}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="card conflict" aria-label={`Conflict on ${pair.key}`}>
      <div className="ckey">
        {pair.project.includes("↔") || pair.project.includes("/") ? <span className="statustag st-conflict">cross-project</span> : null}
        <span>{pair.project} / key </span><code>{pair.key}</code>
      </div>
      <div className="sides">
        <Side label="A · older" side={pair.a} values={pair.aValues} color={color} onOpenNote={onOpenNote} />
        <Side label="B · newer" flag="the write that collided" side={pair.b} values={pair.bValues} color={color} onOpenNote={onOpenNote} />
      </div>
      <div className="resolve">
        <button className="btn" disabled={busy} onClick={() => run("keep_a")}>Keep A</button>
        <button className="btn" disabled={busy} onClick={() => run("keep_b")}>Keep B</button>
        <button className="btn" disabled={busy} aria-expanded={reconciling} onClick={() => setReconciling((v) => !v)}>Keep both…</button>
        <span className="note">Each choice is one commit · the other note is superseded, never deleted</span>
      </div>
      {reconciling && (
        <div className="recon">
          <label htmlFor={`rec-${pair.id}`}>Reconciliation note — how can both be true?</label>
          <textarea
            id={`rec-${pair.id}`} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Postgres on the shared server, SQLite on each laptop."
          />
          <button className="btn primary" style={{ marginTop: 10 }} disabled={busy || !note.trim()} onClick={() => run("keep_both")}>
            Keep both with this note
          </button>
        </div>
      )}
      {error && <p className="banner err" role="alert" style={{ marginTop: 13, marginBottom: 0 }}>{error}</p>}
    </section>
  );
}

/** The Conflicts inbox: every detected contradiction, side by side, with the three resolve actions. */
export function ConflictsView({
  data, color, onResolved, onOpenNote,
}: {
  data: ConflictsData; color: Map<string, string>; onResolved: () => void; onOpenNote: (id: string) => void;
}) {
  const [done, setDone] = useState<string>();

  return (
    <div className="view">
      {done && (
        <div className="banner good" role="status">
          <Icon name="archive" />Resolved. {done}
        </div>
      )}
      <div className="conflist">
        {data.conflicts.length === 0 && data.flagged.length === 0 && (
          <p className="empty">No unresolved conflicts. When an agent saves a note that contradicts another, it lands here.</p>
        )}
        {data.conflicts.map((pair) => (
          <Pair key={pair.id} pair={pair} color={color} onOpenNote={onOpenNote}
            onResolved={(msg) => { setDone(msg); onResolved(); }} />
        ))}
        {data.flagged.length > 0 && (
          <section className="card conflict">
            <div className="ckey"><span className="statustag st-conflict">flagged by hand</span><span>no detected counterpart</span></div>
            <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
              These carry <code className="mono">status: conflict</code> but have no detected pair; edit the file to clear the flag.
            </p>
            <div className="legend">
              {data.flagged.map((f) => (
                <button key={f.id} className="legrow" onClick={() => onOpenNote(f.id)}>
                  <span className="sw" style={{ background: color.get(f.project), ["--sw" as string]: color.get(f.project) }} />
                  <span className="nm">{f.title}</span><span className="ct">{f.project}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
